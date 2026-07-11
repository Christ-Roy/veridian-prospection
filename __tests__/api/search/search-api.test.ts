/**
 * Tests des routes /api/search/* — auth M2M + validation des filtres.
 * Le SQL réel est validé sur le banc (clone prod) ; ici on couvre l'auth,
 * la validation d'entrée et le contrat de réponse (prisma mocké).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

const SECRET = "test-search-secret-xyz";

const { prismaMock } = vi.hoisted(() => {
  const txQuery = vi.fn();
  return {
    prismaMock: {
      // $queryRawUnsafe direct (compat) + $transaction qui passe un `tx` au callback.
      $queryRawUnsafe: txQuery,
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
        cb({ $executeRawUnsafe: vi.fn(), $queryRawUnsafe: txQuery }),
      ),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: () => false }));

import { POST as estimatePOST } from "@/app/api/search/estimate/route";
import { POST as companiesPOST } from "@/app/api/search/companies/route";
import { GET as fieldsGET } from "@/app/api/search/fields/route";
import { POST as distributionPOST } from "@/app/api/search/distribution/route";

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

  test("estimate: 200 + contrat de réponse (incl. breakdown e-commerce) sur filtre valide", async () => {
    // 5 requêtes désormais : agg, puis Promise.all([secteur, dept, ecom_level, ecom_platform]).
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ total: BigInt(42), with_phone: BigInt(30), with_email: BigInt(20), with_both: BigInt(15) }])
      .mockResolvedValueOnce([{ key: "RESTAURATION", count: BigInt(42) }])
      .mockResolvedValueOnce([{ key: "69", count: BigInt(42) }])
      .mockResolvedValueOnce([{ key: "boutique", count: BigInt(25) }, { key: "aucun", count: BigInt(17) }])
      .mockResolvedValueOnce([{ key: "woocommerce", count: BigInt(15) }, { key: "shopify", count: BigInt(10) }]);
    const res = await estimatePOST(
      req({ filters: { all: [{ field: "departement", op: "eq", value: "69" }] } }, BEARER),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.estimated_count).toBe(42);
    expect(json.actionable.with_phone_and_email).toBe(15);
    // le breakdown e-commerce est bien exposé (ventilation niveau + plateforme).
    expect(json.breakdown.by_ecom_level).toEqual([
      { key: "boutique", count: 25 },
      { key: "aucun", count: 17 },
    ]);
    expect(json.breakdown.by_ecom_platform[0]).toEqual({ key: "woocommerce", count: 15 });
  });
});

describe("/api/search/distribution — auth, validation, contrat", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SEARCH_API_SECRET = SECRET;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  test("401 sans token", async () => {
    const res = await distributionPOST(req({ group_by: "ecom_platform" }));
    expect(res.status).toBe(401);
  });

  test("400 si ni group_by ni metric", async () => {
    const res = await distributionPOST(req({}, BEARER));
    expect(res.status).toBe(400);
  });

  test("400 si group_by ET metric ensemble (exclusifs)", async () => {
    const res = await distributionPOST(req({ group_by: "ecom_level", metric: "chiffre_affaires" }, BEARER));
    expect(res.status).toBe(400);
  });

  test("400 sur champ inconnu (anti-injection)", async () => {
    const res = await distributionPOST(req({ group_by: "evil; DROP TABLE entreprises" }, BEARER));
    expect(res.status).toBe(400);
  });

  test("400 group_by sur un champ numérique → guide vers metric", async () => {
    const res = await distributionPOST(req({ group_by: "chiffre_affaires" }, BEARER));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toMatch(/metric/);
  });

  test("200 group_by catégoriel : top-N + volumes actionnables", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      { key: "woocommerce", count: BigInt(100), with_phone: BigInt(60), with_email: BigInt(40) },
      { key: "shopify", count: BigInt(30), with_phone: BigInt(20), with_email: BigInt(15) },
    ]);
    const res = await distributionPOST(
      req({ group_by: "ecom_platform", filters: { all: [{ field: "ecom_level", op: "eq", value: "boutique" }] } }, BEARER),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe("group_by");
    expect(json.field).toBe("ecom_platform");
    expect(json.buckets[0]).toMatchObject({ key: "woocommerce", count: 100, with_phone: 60, with_email: 40 });
    expect(json.total).toBe(130);
  });

  test("200 metric numérique : stats percentiles + histogramme dense", async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ count: BigInt(1000), min: 0, max: 1000, avg: 400, median: 350, p25: 200, p75: 700, p90: 900 }])
      .mockResolvedValueOnce([{ bucket: 1, count: BigInt(500) }, { bucket: 10, count: BigInt(50) }]);
    const res = await distributionPOST(req({ metric: "chiffre_affaires", buckets: 10 }, BEARER));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe("metric");
    expect(json.stats).toMatchObject({ count: 1000, min: 0, max: 1000, median: 350, p90: 900 });
    // histogramme reconstruit dense (tous les buckets, même vides).
    expect(json.histogram).toHaveLength(10);
    expect(json.histogram[0]).toMatchObject({ bucket: 1, count: 500 });
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
