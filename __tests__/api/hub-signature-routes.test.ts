/**
 * Toutes les routes ouvertes par le secret du Hub, trouvées dans le code (une route neuve est prise d'office) : sans
 * signature, avec une signature fausse ou celle d'un tiers, 401 et pas une lecture en base. Signée par le second
 * secret (VER-251), la porte s'ouvre, donc ce n'est plus un 401.
 * Signature v2 (VER-264, CONTRAT-HUB §6.1, signataire `veridian-hub/lib/hmac/signature-hub.ts`) : elle ouvre la porte
 * pour SA méthode et SA route seulement, une seule fois ; `VERIDIAN_HMAC_REQUIRE_V2` ferme la v1.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const COURANT = "courant-".repeat(6), SECOND = "second-".repeat(6), TIERS = "tiers-".repeat(8);
vi.hoisted(() => {
  process.env.HUB_API_SECRET = "courant-".repeat(6);
  process.env.HUB_API_SECRET_SECOND = "second-".repeat(6);
});
const base = vi.hoisted(() => ({ lectures: 0 }));
vi.mock("@/lib/prisma", () => {
  const modele = new Proxy({}, { get: () => () => { base.lectures++; throw new Error("base touchée"); } });
  return { prisma: new Proxy({}, { get: (_t, k) => (String(k).startsWith("$") ? () => { base.lectures++; throw new Error("base touchée"); } : modele) }) };
});
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: () => false }));
const vues = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/compteurs", () => ({
  tropDeRequetes: async () => { base.lectures++; return false; },
  // Usage unique des signatures v2 : la vraie table est éprouvée dans e2e/integration/signature-hub-v2.test.ts.
  consommer: async (cle: string, f: Date) => { const k = `${cle}|${f.toISOString()}`; const neuf = !vues.has(k); vues.add(k); return { accepte: neuf, total: 1 }; },
}));
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));

const racine = path.resolve(__dirname, "../../src/app/api");
const fichiers = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? fichiers(path.join(d, f)) : f === "route.ts" ? [path.join(d, f)] : []));
const routes = fichiers(racine).filter((f) => /\b(requireHubHmac|verifierAppelHub)\b\s*(<[^>]*>)?\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(racine, f));
const ID = "11111111-1111-4111-8111-111111111111";
const CORPS = { hub_user_id: ID, hub_tenant_id: ID, tenant_id: ID, user_id: ID, email: "a@exemple.fr", owner_email: "a@exemple.fr", plan: "pro", role: "member" };

/** La v2 telle que le Hub la calcule (copie de `entetesSignature`, recalculée ici indépendamment du code de l'app). */
const v2 = (secret: string, ts: number, methode: string, url: string, corps: string) => {
  const u = new URL(url);
  return createHmac("sha256", secret).update([ts, methode.toUpperCase(), u.pathname, u.search.replace(/^\?/, ""), createHash("sha256").update(corps).digest("hex")].join("\n")).digest("hex");
};
type Signature = { version?: "v1" | "v2"; ts?: number; methode?: string; url?: string };

async function appeler(route: string, secret: string | null, corpsPoste: string = JSON.stringify(CORPS), sig: Signature = {}): Promise<(number | "leve")[]> {
  const m = (await import(path.join(racine, route))) as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>;
  const statuts: (number | "leve")[] = [];
  for (const methode of ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((x) => typeof m[x] === "function")) {
    const corps = methode === "GET" ? "" : corpsPoste;
    const ts = sig.ts ?? Date.now();
    const url = `https://x/api/${route}?email=a%2Bb@exemple.fr`;
    const signature = secret === null ? "" : sig.version === "v2" ? v2(secret, ts, sig.methode ?? methode, sig.url ?? url, corps) : createHmac("sha256", secret).update(`${ts}.${corps}`).digest("hex");
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250)}`, ...(secret === null ? {} : { "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": signature }), ...(sig.version === "v2" ? { "x-veridian-sig-version": "2" } : {}) };
    const req = new NextRequest(url, { method: methode, headers, ...(methode === "GET" ? {} : { body: corps }) });
    statuts.push(await m[methode](req, { params: Promise.resolve({ id: ID, workspaceId: ID }) }).then((r) => r.status, () => "leve" as const));
  }
  return statuts;
}

beforeEach(() => {
  base.lectures = 0;
  for (const k of ["log", "warn", "error", "info"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});

test("le relevé trouve les routes du contrat", () => {
  expect(routes.length).toBeGreaterThanOrEqual(20);
  for (const r of ["sso/issue-magic-link/route.ts", "tenants/provision/route.ts", "tenants/link-hub/route.ts", "users/by-email/route.ts", "tenants/[id]/purge/route.ts"]) expect(routes).toContain(r);
});

describe.each(routes)("%s", (route) => {
  test.each([["sans signature", null], ["signée par un tiers", TIERS], ["signée par le vide", ""]])("%s : 401, base intacte", async (_n, secret) => {
    const s = await appeler(route, secret);
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x === 401), `${route} ${s}`).toBe(true);
    expect(base.lectures).toBe(0);
  });
  test.each([["vide", ""], ["{}", "{}"], ["pas du JSON", "{"]])("corps %s signé par un tiers : 401 avant toute lecture du corps", async (_n, corps) => {
    expect((await appeler(route, TIERS, corps)).every((x) => x === 401), route).toBe(true);
    expect(base.lectures).toBe(0);
  });
  test.each([["le courant", COURANT], ["le second", SECOND]])("signée par %s : la porte s'ouvre", async (_n, secret) => {
    expect((await appeler(route, secret)).includes(401)).toBe(false);
  });
  test.each([["le courant", COURANT], ["le second", SECOND]])("v2 signée par %s : la porte s'ouvre, une fois ; rejouée : 401", async (_n, secret) => {
    const ts = Date.now();
    expect((await appeler(route, secret, undefined, { version: "v2", ts })).includes(401)).toBe(false);
    expect((await appeler(route, secret, undefined, { version: "v2", ts })).every((x) => x === 401), route).toBe(true);
  });
  test.each([
    ["une autre méthode", { methode: "PATCH" }],
    ["une autre route", { url: "https://x/api/tenants/autre/purge?email=a%2Bb@exemple.fr" }],
    ["une autre requête", { url: `https://x/api/${route}?email=c@exemple.fr` }],
  ])("v2 signée pour %s : 401, base intacte", async (_n, o) => {
    expect((await appeler(route, COURANT, undefined, { version: "v2", ...o })).every((x) => x === 401), route).toBe(true);
    expect(base.lectures).toBe(0);
  });
  test("v2 dont le corps a changé : 401", async () => {
    const m = (await import(path.join(racine, route))) as Record<string, unknown>;
    if (!["POST", "PUT", "PATCH", "DELETE"].some((x) => typeof m[x] === "function")) return;
    const ts = Date.now(), url = `https://x/api/${route}?email=a%2Bb@exemple.fr`, corps = JSON.stringify(CORPS);
    for (const methode of ["POST", "PUT", "PATCH", "DELETE"].filter((x) => typeof m[x] === "function")) {
      const req = new NextRequest(url, { method: methode, body: corps.replace("member", "admin"), headers: { "content-type": "application/json", "x-veridian-timestamp": String(ts), "x-veridian-sig-version": "2", "x-veridian-hub-signature": v2(COURANT, ts, methode, url, corps) } });
      expect((await (m[methode] as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id: ID, workspaceId: ID }) })).status).toBe(401);
    }
  });
  test("VERIDIAN_HMAC_REQUIRE_V2 : la v1 est refusée, la v2 passe", async () => {
    vi.stubEnv("VERIDIAN_HMAC_REQUIRE_V2", "1");
    try {
      expect((await appeler(route, COURANT)).every((x) => x === 401), route).toBe(true);
      expect(base.lectures).toBe(0);
      expect((await appeler(route, COURANT, undefined, { version: "v2" })).includes(401)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
