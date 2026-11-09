/**
 * Bascule pg-saas : HAProxy garde la connexion ouverte alors qu'aucun primaire ne répond. Un faux
 * serveur PostgreSQL (TCP muet, ou poignée de main puis silence) remplace la base ; moteur Prisma réel.
 *
 * Ce qui est prouvé : l'ouverture d'une connexion échoue vite grâce aux bornes ; une requête sur une
 * connexion déjà ouverte attend sans fin dans Prisma (aucun paramètre d'URL n'y peut rien), donc le
 * filet est /api/health (503 en 2 s) + `check_restart` du job, qui redémarre l'allocation.
 */
import { readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

import { BORNES_DB, avecBornes } from "@/lib/db-bornes";

type Serveur = { port: number; fermer: () => Promise<void> };

/** `muet` : n'importe quand. `apres-poignee` : authentifie, se déclare prêt, puis ne répond plus. */
async function fauxPostgres(mode: "muet" | "apres-poignee"): Promise<Serveur> {
  const sockets = new Set<net.Socket>();
  const srv = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
    if (mode === "muet") return;
    let tampon = Buffer.alloc(0);
    let pret = false;
    s.on("data", (d) => {
      if (pret) return; // plus rien ne répond : le primaire a disparu
      tampon = Buffer.concat([tampon, d]);
      while (tampon.length >= 8) {
        const long = tampon.readInt32BE(0);
        if (tampon.length < long) return;
        const code = tampon.readInt32BE(4);
        tampon = tampon.subarray(long);
        if (code === 80877103) {
          s.write("N"); // pas de TLS
          continue;
        }
        const msg = (type: string, corps: Buffer) => {
          const h = Buffer.alloc(5);
          h.write(type, 0);
          h.writeInt32BE(corps.length + 4, 1);
          return Buffer.concat([h, corps]);
        };
        const param = (k: string, v: string) => msg("S", Buffer.from(`${k}\0${v}\0`));
        const cle = Buffer.alloc(8);
        cle.writeInt32BE(4242, 0);
        cle.writeInt32BE(7, 4);
        s.write(
          Buffer.concat([
            msg("R", Buffer.from([0, 0, 0, 0])),
            param("server_version", "16.4"),
            param("server_encoding", "UTF8"),
            param("client_encoding", "UTF8"),
            param("standard_conforming_strings", "on"),
            param("DateStyle", "ISO, MDY"),
            param("integer_datetimes", "on"),
            param("TimeZone", "UTC"),
            msg("K", cle),
            msg("Z", Buffer.from("I")),
          ]),
        );
        pret = true;
        return;
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  return {
    port,
    fermer: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        srv.close(() => r());
      }),
  };
}

const ouverts: { client: PrismaClient; srv: Serveur }[] = [];
afterEach(async () => {
  for (const { client, srv } of ouverts.splice(0)) {
    await srv.fermer();
    await client.$disconnect().catch(() => {});
  }
});

function client(srv: Serveur, params: string) {
  const c = new PrismaClient({ datasources: { db: { url: `postgresql://u:p@127.0.0.1:${srv.port}/db?${params}` } } });
  ouverts.push({ client: c, srv });
  return c;
}

/** Issue d'une promesse après `ms` : « en attente », « rejetée » ou « tenue ». */
async function etatApres<T>(p: Promise<T>, ms: number) {
  const t0 = Date.now();
  const etat = await Promise.race([
    p.then(() => "tenue" as const, () => "rejetee" as const),
    new Promise<"attente">((r) => setTimeout(() => r("attente"), ms)),
  ]);
  return { etat, ms: Date.now() - t0 };
}

describe("bornes de connexion PostgreSQL", () => {
  test("avecBornes ajoute les bornes manquantes et respecte une valeur explicite", () => {
    const u = new URL(avecBornes("postgresql://app:mot%40passe@pg:5432/base?connection_limit=10&socket_timeout=30"));
    for (const k of Object.keys(BORNES_DB)) expect(u.searchParams.has(k)).toBe(true);
    expect(u.searchParams.get("socket_timeout")).toBe("30");
    expect(u.searchParams.get("connection_limit")).toBe("10");
    expect(u.password).toBe("mot%40passe");
    expect(avecBornes(avecBornes("postgresql://a@b/c"))).toBe(avecBornes("postgresql://a@b/c"));

    expect(avecBornes("file:./dev.db")).toBe("file:./dev.db");
  });

  test("primaire disparu après la poignée de main : la requête Prisma attend sans fin, socket_timeout compris", async () => {
    // Si ce test échoue un jour, Prisma sait enfin couper une requête : poser socket_timeout dans BORNES_DB.
    const srv = await fauxPostgres("apres-poignee");
    const r = await etatApres(client(srv, "connect_timeout=5&pool_timeout=5&socket_timeout=2").$queryRaw`SELECT 1`, 6000);
    expect(r.etat).toBe("attente");
  }, 15_000);

  test("primaire disparu : /api/health répond 503 en moins de 3 s au lieu d'attendre", async () => {
    const srv = await fauxPostgres("apres-poignee");
    const avant = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `postgresql://u:p@127.0.0.1:${srv.port}/db`;
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma; // jamais le client d'un autre test
    const { GET } = await import("@/app/api/health/route");
    const { prisma } = await import("@/lib/prisma");
    ouverts.push({ client: prisma, srv });
    process.env.DATABASE_URL = avant;
    const t0 = Date.now();
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe("ko");
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 15_000);

  test("un seul client Prisma dans l'app : aucun autre `new PrismaClient` sous src/", () => {
    const racine = path.resolve(__dirname, "../../src");
    const fautifs: string[] = [];
    const parcourir = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) parcourir(f);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /new PrismaClient\s*\(/.test(readFileSync(f, "utf8"))) {
          fautifs.push(path.relative(racine, f));
        }
      }
    };
    parcourir(racine);
    expect(fautifs).toEqual(["lib/prisma.ts"]);
  });

  test("le pool du job reste à 8 connexions au plus (pg-saas : 100 pour cinq apps)", () => {
    const hcl = readFileSync(path.resolve(__dirname, "../../deploy/prospection.nomad.hcl"), "utf8");
    const limite = /DATABASE_URL=[^\n]*connection_limit=(\d+)/.exec(hcl)?.[1];
    expect(Number(limite)).toBeGreaterThan(0);
    expect(Number(limite)).toBeLessThanOrEqual(8);
    expect(new URL(avecBornes("postgresql://a@b/c")).searchParams.get("connection_limit")).toBe("8");
  });

  test("le job redémarre l'allocation quand /api/health échoue (check_restart)", () => {
    const hcl = readFileSync(path.resolve(__dirname, "../../deploy/prospection.nomad.hcl"), "utf8");
    const tache = hcl.slice(hcl.indexOf('task "prospection"'));
    expect(tache).toMatch(/path\s*=\s*"\/api\/health"[\s\S]*?check_restart\s*\{[\s\S]*?limit\s*=\s*\d+/);
  });

  test("entrée muette (TCP accepté, aucune réponse) : les bornes par défaut échouent vite", async () => {
    const srv = await fauxPostgres("muet");
    const url = new URL(avecBornes(`postgresql://u:p@127.0.0.1:${srv.port}/db`));
    const r = await etatApres(client(srv, url.searchParams.toString()).$queryRaw`SELECT 1`, 25_000);
    expect(r.etat).toBe("rejetee");
    expect(r.ms).toBeLessThan(20_000);
  }, 30_000);
});
