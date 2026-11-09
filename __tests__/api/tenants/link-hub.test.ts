/**
 * POST /api/tenants/link-hub : relie le tenant du propriétaire à son tenant Hub, et ne touche rien
 * d'autre (ni workspace, ni membre, ni jeton, ni clé) : le mock Prisma n'expose que user et tenant,
 * tout autre accès ferait échouer le test.
 */
import { createHmac } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "secret-lien";
});

const { userFindFirst, tenantFindFirst, tenantUpdate } = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  tenantFindFirst: vi.fn(),
  tenantUpdate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findFirst: userFindFirst }, tenant: { findFirst: tenantFindFirst, update: tenantUpdate } },
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));

import { POST } from "@/app/api/tenants/link-hub/route";
import { makeRequest, readJson } from "../_helpers";

const HU = "11111111-1111-4111-8111-111111111111";
const HT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function appel(corps: unknown, signe = true) {
  const raw = JSON.stringify(corps);
  const ts = Date.now();
  const headers: Record<string, string> = signe
    ? { "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": createHmac("sha256", "secret-lien").update(`${ts}.${raw}`).digest("hex") }
    : {};
  return POST(makeRequest("/api/tenants/link-hub", { method: "POST", headers, body: raw }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  userFindFirst.mockResolvedValue({ id: "u-local" });
});

describe("POST /api/tenants/link-hub", () => {
  test("sans signature du Hub : 401, aucune lecture", async () => {
    expect((await appel({ hub_user_id: HU, hub_tenant_id: HT }, false)).status).toBe(401);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  test("identifiants invalides : 400", async () => {
    expect((await appel({ hub_user_id: HU, hub_tenant_id: "mon-espace" })).status).toBe(400);
  });

  test("utilisateur inconnu : 404 user_unknown", async () => {
    userFindFirst.mockResolvedValue(null);
    const r = await appel({ hub_user_id: HU, hub_tenant_id: HT });
    expect(r.status).toBe(404);
    expect(await readJson(r)).toEqual({ error: "user_unknown" });
  });

  test("tenant non relié : relié, et seule la colonne hub_tenant_id est écrite", async () => {
    tenantFindFirst.mockResolvedValueOnce({ id: "t-1", hubTenantId: null }).mockResolvedValueOnce(null);
    const r = await appel({ hub_user_id: HU, hub_tenant_id: HT.toUpperCase() });
    expect(await readJson(r)).toEqual({ linked: true, raison: "relie", tenant_id: "t-1" });
    expect(tenantUpdate).toHaveBeenCalledTimes(1);
    expect(tenantUpdate).toHaveBeenCalledWith({ where: { id: "t-1" }, data: { hubTenantId: HT } });
  });

  test("déjà relié à la même valeur : rien n'est écrit", async () => {
    tenantFindFirst.mockResolvedValueOnce({ id: "t-1", hubTenantId: HT });
    expect(await readJson(await appel({ hub_user_id: HU, hub_tenant_id: HT }))).toEqual({ linked: true, raison: "deja_relie", tenant_id: "t-1" });
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("relié à une autre valeur : jamais écrasé", async () => {
    tenantFindFirst.mockResolvedValueOnce({ id: "t-1", hubTenantId: "99999999-9999-4999-8999-999999999999" });
    expect(await readJson(await appel({ hub_user_id: HU, hub_tenant_id: HT }))).toMatchObject({ linked: false, raison: "lien_different" });
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("tenant Hub déjà relié à un autre tenant local : refusé", async () => {
    tenantFindFirst.mockResolvedValueOnce({ id: "t-1", hubTenantId: null }).mockResolvedValueOnce({ id: "t-autre" });
    expect(await readJson(await appel({ hub_user_id: HU, hub_tenant_id: HT }))).toMatchObject({ linked: false, raison: "tenant_hub_deja_pris" });
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("aucun tenant pour ce propriétaire : linked false", async () => {
    tenantFindFirst.mockResolvedValueOnce(null);
    expect(await readJson(await appel({ hub_user_id: HU, hub_tenant_id: HT }))).toEqual({ linked: false, raison: "aucun_tenant", tenant_id: null });
  });
});
