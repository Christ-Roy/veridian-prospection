/**
 * Compteurs en base (VER-242, 24/11) : le quota de verifier_entreprises et la limite de connexion tiennent après un
 * redémarrage et entre deux instances (en mémoire, 100 SIREN passaient pour un quota de 50). Exige DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
});
import { prisma } from "@/lib/prisma";
import { consommer, menage, minuitParis, rendre, tropDeRequetes } from "@/lib/compteurs";
import { reserverVerification } from "@/atlas/outils-mcp";

const id = () => `essai-${randomUUID()}`;
afterAll(async () => {
  await prisma.compteur.deleteMany({ where: { cle: { contains: "essai-" } } });
  await prisma.$disconnect();
});

describe("quota de vérification", () => {
  test("survit à un redémarrage et vaut pour deux instances ; rouvert le lendemain ; par espace", async () => {
    const t = id();
    expect((await reserverVerification(t, 30, 50)).reste).toBe(20);
    vi.resetModules(); // mémoire neuve : redémarrage, ou seconde instance
    const b = await import("@/atlas/outils-mcp");
    await expect(b.reserverVerification(t, 50, 50)).rejects.toThrow(/30 SIREN vérifiés sur 50, il en reste 20.*plan payant/);
    expect((await b.reserverVerification(t, 20, 50)).reste).toBe(0);
    await expect(reserverVerification(t, 1, 50)).rejects.toThrow(/il en reste 0/);
    expect((await reserverVerification(id(), 50, 50)).reste).toBe(0);
    await prisma.$executeRaw`UPDATE compteurs SET fenetre = fenetre - interval '1 day' WHERE cle = ${`verification:${t}`}`;
    expect((await reserverVerification(t, 50, 50)).reste).toBe(0);
  });

  test("la fenêtre du jour est minuit à Paris, aujourd'hui", async () => {
    const f = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", ...o });
    const j = await minuitParis();
    expect(f(j, { hour: "2-digit", minute: "2-digit", second: "2-digit" })).toBe("00:00:00");
    expect(f(j, { dateStyle: "short" })).toBe(f(new Date(), { dateStyle: "short" }));
  });

  test("40 demandes simultanées de 3 pour un plafond de 50 : 16 passent, jamais 51", async () => {
    const t = id();
    const r = await Promise.allSettled(Array.from({ length: 40 }, () => reserverVerification(t, 3, 50)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(16);
    const l = await prisma.compteur.findMany({ where: { cle: `verification:${t}` } });
    expect(l.map((x) => x.n)).toEqual([48]);
  });

  test("un travail qui n'aboutit pas se rend ; une demande au-dessus du plafond ne compte rien", async () => {
    const cle = id();
    const j = await minuitParis();
    expect(await consommer(cle, j, 51, 50)).toEqual({ accepte: false, total: 0 });
    expect(await consommer(cle, j, 40, 50)).toEqual({ accepte: true, total: 40 });
    await rendre(cle, j, 40);
    expect(await consommer(cle, j, 50, 50)).toEqual({ accepte: true, total: 50 });
  });
});

test("limite de connexion : 10 par minute, toutes instances ; le ménage n'efface que l'ancien", async () => {
  const cle = id();
  const r = await Promise.all(Array.from({ length: 25 }, () => tropDeRequetes(cle, 10, 3_600_000)));
  expect(r.filter((x) => !x)).toHaveLength(10);
  const vieux = id();
  await consommer(vieux, new Date(Date.now() - 3 * 24 * 3600 * 1000), 1, 5);
  await menage();
  expect(await prisma.compteur.count({ where: { cle: vieux } })).toBe(0);
  expect(await prisma.compteur.count({ where: { cle } })).toBe(1);
});
