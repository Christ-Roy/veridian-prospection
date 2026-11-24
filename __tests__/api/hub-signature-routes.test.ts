/**
 * Toutes les routes ouvertes par le secret du Hub, trouvées dans le code (une route neuve est prise d'office) : sans
 * signature, avec une signature fausse ou celle d'un tiers, 401 et pas une lecture en base. Signée par le second
 * secret (VER-251), la porte s'ouvre, donc ce n'est plus un 401.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
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
vi.mock("@/lib/compteurs", () => ({ tropDeRequetes: async () => { base.lectures++; return false; } }));
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));

const racine = path.resolve(__dirname, "../../src/app/api");
const fichiers = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? fichiers(path.join(d, f)) : f === "route.ts" ? [path.join(d, f)] : []));
const routes = fichiers(racine).filter((f) => /\b(requireHubHmac|verifierAppelHub)\b\s*(<[^>]*>)?\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(racine, f));
const ID = "11111111-1111-4111-8111-111111111111";
const CORPS = { hub_user_id: ID, hub_tenant_id: ID, tenant_id: ID, user_id: ID, email: "a@exemple.fr", owner_email: "a@exemple.fr", plan: "pro", role: "member" };

async function appeler(route: string, secret: string | null, corpsPoste: string = JSON.stringify(CORPS)): Promise<(number | "leve")[]> {
  const m = (await import(path.join(racine, route))) as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>;
  const statuts: (number | "leve")[] = [];
  for (const methode of ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((x) => typeof m[x] === "function")) {
    const corps = methode === "GET" ? "" : corpsPoste;
    const ts = Date.now();
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250)}`, ...(secret === null ? {} : { "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": createHmac("sha256", secret).update(`${ts}.${corps}`).digest("hex") }) };
    const req = new NextRequest(`https://x/api/${route}?email=a@exemple.fr`, { method: methode, headers, ...(methode === "GET" ? {} : { body: corps }) });
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
});
