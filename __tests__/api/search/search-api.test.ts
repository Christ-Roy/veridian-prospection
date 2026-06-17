/**
 * Tests des routes /api/search/* — auth M2M + validation des filtres.
 * Le SQL réel est validé sur le banc (clone prod) ; ici on couvre l'auth,
 * la validation d'entrée et le contrat de réponse (prisma mocké).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-search-secret-xyz";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $queryRawUnsafe: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: () => false }));

import { POST as estimatePOST } from "@/app/api/search/estimate/route";
import { POST as companiesPOST } from "@/app/api/search/companies/route";
import { GET as fieldsGET } from "@/app/api/search/fields/route";

function req(body: unknown, auth?: string, method = "POST"): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new Request("https://x/api/search/estimate", {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

const BEARER = `Bearer ${SECRET}`;

describe("/api/search/* — auth", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SEARCH_API_SECRET = SECRET;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  test("estimate: 401 sans token", async () => {
    const res = await estimatePOST(req({ filters: { all: [] } }));
    expect(res.status).toBe(401);
  });

  test("companies: 401 sans token", async () => {
    const res = await companiesPOST(req({ filters: { all: [] } }));
    expect(res.status).toBe(401);
  });

  test("fields: 401 sans token", async () => {
    const res = await fieldsGET(req({}, undefined, "GET"));
    expect(res.status).toBe(401);
  });

  test("fields: 200 + catalogue avec token", async () => {
    const res = await fieldsGET(req({}, BEARER, "GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBeGreaterThan(0);
    expect(Array.isArray(json.fields)).toBe(true);
  });
});

describe("/api/search/* — validation", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SEARCH_API_SECRET = SECRET;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  test("estimate: 400 sur champ inconnu (anti-injection)", async () => {
    const res = await estimatePOST(
      req({ filters: { all: [{ field: "x; DROP TABLE entreprises", op: "eq", value: 1 }] } }, BEARER),
    );
    expect(res.status).toBe(400);
  });

  test("estimate: 400 sur filtres vides", async () => {
    const res = await estimatePOST(req({ filters: {} }, BEARER));
    expect(res.status).toBe(400);
  });

  test("companies: 400 sur champ de projection inconnu", async () => {
    const res = await companiesPOST(
      req({ filters: { all: [{ field: "siren", op: "exists", value: true }] }, fields: ["evil_col"] }, BEARER),
    );
    expect(res.status).toBe(400);
  });

  test("estimate: 200 + contrat de réponse sur filtre valide", async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ total: BigInt(42), with_phone: BigInt(30), with_email: BigInt(20), with_both: BigInt(15) }])
      .mockResolvedValueOnce([{ key: "RESTAURATION", count: BigInt(42) }])
      .mockResolvedValueOnce([{ key: "69", count: BigInt(42) }]);
    const res = await estimatePOST(
      req({ filters: { all: [{ field: "departement", op: "eq", value: "69" }] } }, BEARER),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.estimated_count).toBe(42);
    expect(json.actionable.with_phone_and_email).toBe(15);
  });

  test("companies: 200 + résultats projetés sur filtre valide", async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ siren: "451556062", denomination: "CCDD", chiffre_affaires: BigInt(625075) }])
      .mockResolvedValueOnce([{ c: BigInt(1) }]);
    const res = await companiesPOST(
      req({ filters: { all: [{ field: "departement", op: "eq", value: "69" }] }, fields: ["siren", "denomination", "chiffre_affaires"] }, BEARER),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].siren).toBe("451556062");
    expect(json.total_exact).toBe(1);
  });
});
