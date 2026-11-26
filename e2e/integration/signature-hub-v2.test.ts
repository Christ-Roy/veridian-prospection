/**
 * Signature v2 du Hub (VER-264, CONTRAT-HUB §6.1) sur vraie base : usage unique tenu par la table compteurs, donc
 * valable pour toutes les instances ; deux envois simultanés de la même signature, un seul passe. Exige DATABASE_URL.
 */
import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, expect, test, vi } from "vitest";

const SECRET = vi.hoisted(() => (process.env.HUB_API_SECRET = "secret-epreuve-signature-v2-0123456789"));

import { GET as parEmail } from "@/app/api/users/by-email/route";
import { verifierAppelHub } from "@/lib/hub/secrets";
import { prisma } from "@/lib/prisma";

const URL_ = "https://prospection.app.veridian.site/api/users/by-email?email=personne%2Bv2@exemple.invalid";
const signer = (ts: number, methode = "GET", url = URL_, corps = "") => {
  const u = new URL(url);
  return createHmac("sha256", SECRET).update([ts, methode, u.pathname, u.search.slice(1), createHash("sha256").update(corps).digest("hex")].join("\n")).digest("hex");
};
const requete = (ts: number, signature: string) =>
  new NextRequest(URL_, { headers: { "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": signature, "x-veridian-sig-version": "2" } });

afterAll(async () => {
  await prisma.compteur.deleteMany({ where: { cle: { startsWith: "hub-sig:" } } });
  await prisma.$disconnect();
});

test("la route sert une fois une signature v2, puis la refuse", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const ts = Date.now();
  const premiere = await parEmail(requete(ts, signer(ts)));
  expect(premiere.status).not.toBe(401);
  const rejouee = await parEmail(requete(ts, signer(ts)));
  expect(rejouee.status).toBe(401);
});

test("deux envois simultanés de la même signature : un seul passe", async () => {
  const ts = Date.now() + 1;
  const s = signer(ts);
  const v = await Promise.all(Array.from({ length: 6 }, () => verifierAppelHub(requete(ts, s), "")));
  expect(v.filter((x) => x.ok)).toHaveLength(1);
  expect(v.filter((x) => !x.ok && x.reason === "signature_replayed")).toHaveLength(5);
});

test("une signature v2 fausse ne consomme rien", async () => {
  const ts = Date.now() + 2;
  expect(await verifierAppelHub(requete(ts, signer(ts, "DELETE")), "")).toMatchObject({ ok: false, reason: "invalid_signature" });
  expect(await prisma.compteur.count({ where: { cle: `hub-sig:${signer(ts, "DELETE")}` } })).toBe(0);
  expect(await verifierAppelHub(requete(ts, signer(ts)), "")).toMatchObject({ ok: true, version: "v2" });
});
