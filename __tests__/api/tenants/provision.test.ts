/**
 * POST /api/tenants/provision : la porte seulement (signature, lecture du corps, refus). L'ouverture elle-même est éprouvée sur vraie base :
 * e2e/integration/provision.test.ts.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-secret-xyz";
});
const m = vi.hoisted(() => ({ ouvrir: vi.fn() }));
vi.mock("@/lib/hub/ouvrir-espace", () => {
  class RefusOuverture extends Error {
    constructor(readonly code: string, readonly statut: number, readonly detail: Record<string, unknown> = {}) {
      super(code);
    }
  }
  return { RefusOuverture, ouvrirEspace: m.ouvrir };
});
vi.mock("@/lib/auth/jeton-connexion", () => ({ emettreJetonConnexion: async () => ({ jeton: "jeton-unique" }) }));

import { POST } from "@/app/api/tenants/provision/route";
import { RefusOuverture } from "@/lib/hub/ouvrir-espace";
import { makeRequest, readJson } from "../_helpers";

const HUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let n = 0;
const hubNeuf = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`;
function entetes(corps: string, o: { driftMs?: number; badSig?: boolean } = {}) {
  const ts = Date.now() + (o.driftMs ?? 0);
  return { "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": o.badSig ? "00".repeat(32) : createHmac("sha256", "test-secret-xyz").update(`${ts}.${corps}`).digest("hex") };
}
async function poster(corps: unknown, o: { driftMs?: number; badSig?: boolean; headers?: Record<string, string> } = {}) {
  const brut = typeof corps === "string" ? corps : JSON.stringify(corps);
  const r = await POST(makeRequest("/api/tenants/provision", { method: "POST", headers: o.headers ?? entetes(brut, o), body: brut }));
  return { s: r.status, j: (await readJson(r)) as Record<string, unknown> };
}
beforeEach(() => {
  m.ouvrir.mockReset();
  m.ouvrir.mockResolvedValue({ user_id: "u", tenant_id: "t", hub_tenant_id: ORG, workspace_id: "w", role: "admin", plan: "freemium", status: "active", name: "N", cree: { compte: true, espace: true, atelier: true, membre: true, lien: true }, apiKey: "cle-tiree" });
});

describe("signature : seule porte, et lue avant le corps", () => {
  test.each([
    ["absente", { headers: {} }, "Unauthorized"],
    ["fausse", { badSig: true }, "Invalid signature"],
    ["vieille de 6 min", { driftMs: -360_000 }, "Timestamp expired or invalid"],
    ["en avance de 6 min", { driftMs: 360_000 }, "Timestamp expired or invalid"],
    ["Bearer, même avec le bon secret", { headers: { authorization: "Bearer test-secret-xyz" } }, "Unauthorized"],
  ])("%s : 401", async (_n, o, erreur) => {
    for (const corps of [{ email: "a@b.fr", user_id: HUB }, "pas du json"]) expect(await poster(corps, o)).toMatchObject({ s: 401, j: { error: erreur } });
    expect(m.ouvrir).not.toHaveBeenCalled();
  });
  test("corps changé après signature, ancien format email:ts : 401", async () => {
    expect((await poster({ email: "b@b.fr" }, { headers: entetes(JSON.stringify({ email: "a@b.fr" })) })).s).toBe(401);
    const ts = Date.now();
    expect((await poster({ email: "a@b.fr", timestamp: ts, signature: createHmac("sha256", "test-secret-xyz").update(`a@b.fr:${ts}`).digest("hex") }, { headers: {} })).s).toBe(401);
  });
});

describe("corps", () => {
  test("refus nommés, rien d'ouvert", async () => {
    for (const [c, code] of [["pas du json", "invalid_payload"], [{}, "email_required"], [{ email: "a@b.fr" }, "hub_user_id_required"], [{ email: "a@b.fr", user_id: HUB, hub_tenant_id: "x" }, "invalid_payload"]] as const) expect(await poster(c)).toMatchObject({ s: 400, j: { error: code, created: false } });
    expect(m.ouvrir).not.toHaveBeenCalled();
  });
  test("identifiants à la racine ou dans metadata, en minuscules ; le plan et le nom suivent", async () => {
    const h = hubNeuf();
    await poster({ email: " A@b.fr ", plan: "pro", name: "Martin", email_proven: true, metadata: { hub_user_id: h.toUpperCase(), hub_tenant_id: ORG.toUpperCase() } });
    expect(m.ouvrir).toHaveBeenCalledWith({ hubUserId: h, email: "A@b.fr", emailProven: true, hubTenantId: ORG, plan: "pro", nom: "Martin" });
    await poster({ email: "a@b.fr", user_id: hubNeuf(), email_proven: "true" });
    expect(m.ouvrir.mock.calls[1][0]).toMatchObject({ emailProven: false, hubTenantId: null });
  });
});

describe("réponse : ce qui a été fait, rien d'autre", () => {
  test("ouvert ; rejoué : created faux, clé dite non tirée", async () => {
    expect(await poster({ email: "a@b.fr", user_id: hubNeuf() })).toMatchObject({ s: 200, j: { created: true, tenant_id: "t", plan: "freemium", api_key: "cle-tiree", api_key_minted: true, login_url: expect.stringContaining("t=jeton-unique") } });
    m.ouvrir.mockResolvedValue({ ...(await m.ouvrir()), apiKey: null, cree: { compte: false, espace: false, atelier: false, membre: false, lien: false } });
    expect((await poster({ email: "a@b.fr", user_id: hubNeuf() })).j).toMatchObject({ created: false, api_key_minted: false });
  });
  test("refus et panne : jamais un 200, jamais un lien de connexion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    m.ouvrir.mockRejectedValueOnce(new RefusOuverture("tenant_soft_deleted", 409, { tenant_id: "t9" }));
    const r = await poster({ email: "a@b.fr", user_id: hubNeuf() });
    expect([r.s, r.j]).toEqual([409, { error: "tenant_soft_deleted", created: false, tenant_id: "t9" }]);
    m.ouvrir.mockRejectedValueOnce(new Error("base muette, secret xyz"));
    const p = await poster({ email: "a@b.fr", user_id: hubNeuf() });
    expect([p.s, p.j]).toEqual([503, { error: "provision_failed", created: false }]);
  });
  test("10 par minute et par personne, pas par machine : une autre personne passe", async () => {
    const h = hubNeuf();
    const s = [];
    for (let i = 0; i < 11; i++) s.push((await poster({ email: "a@b.fr", user_id: h })).s);
    expect([s.filter((x) => x === 200).length, s[10]]).toEqual([10, 429]);
    expect((await poster({ email: "c@b.fr", user_id: hubNeuf() })).s).toBe(200);
  });
});
