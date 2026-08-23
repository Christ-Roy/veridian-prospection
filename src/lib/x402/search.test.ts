import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryX402Companies, queryX402Estimate } = vi.hoisted(() => ({
  queryX402Companies: vi.fn(),
  queryX402Estimate: vi.fn(),
}));

vi.mock("./clickhouse", () => ({
  queryX402Companies,
  queryX402Estimate,
  OdhClickHouseConfigError: class OdhClickHouseConfigError extends Error {},
  OdhClickHouseQueryError: class OdhClickHouseQueryError extends Error {
    constructor(message: string, readonly kind: string) {
      super(message);
    }
  },
}));

import { handleX402Companies, handleX402Estimate } from "./search";

function post(body: unknown): Request {
  return new Request("https://prospection.staging.veridian.site/api/x402/odh/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("x402 search handlers", () => {
  beforeEach(() => {
    queryX402Companies.mockReset();
    queryX402Estimate.mockReset();
  });

  it("refuse les filtres exacts/contains contact sur estimate x402", async () => {
    const res = await handleX402Estimate(
      post({
        filters: { all: [{ field: "phone", op: "contains", value: "+33" }] },
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unsupported x402 contact filter operators: phone:contains" });
    expect(queryX402Estimate).not.toHaveBeenCalled();
  });

  it("masque les petits segments estimate pour éviter la ré-identification", async () => {
    queryX402Estimate.mockResolvedValueOnce({
      agg: { total: 3, with_phone: 1, with_email: 1, with_both: 0 },
      breakdown: {},
      suppressSmallSegment: true,
    });

    const res = await handleX402Estimate(
      post({
        filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      estimated_count: null,
      estimated_count_range: "<5",
      actionable: null,
      breakdown: {},
    });
  });

  it("retourne le volume actionnable et les ventilations d'un segment publiable", async () => {
    queryX402Estimate.mockResolvedValueOnce({
      agg: { total: 12, with_phone: 8, with_email: 9, with_both: 6 },
      breakdown: {
        by_secteur: [{ key: "Commerce", count: 7 }],
        by_departement: [{ key: "69", count: 5 }],
        by_ecom_level: [{ key: "confirmed", count: 4 }],
        by_ecom_platform: [{ key: "shopify", count: 3 }],
      },
      suppressSmallSegment: false,
    });

    const res = await handleX402Estimate(
      post({
        filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
      }) as never,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      estimated_count: 12,
      actionable: {
        with_phone: 8,
        with_email: 9,
        with_phone_and_email: 6,
      },
      breakdown: {
        by_secteur: [{ key: "Commerce", count: 7 }],
        by_departement: [{ key: "69", count: 5 }],
        by_ecom_level: [{ key: "confirmed", count: 4 }],
        by_ecom_platform: [{ key: "shopify", count: 3 }],
      },
    });
    expect(queryX402Estimate).toHaveBeenCalledOnce();
  });

  it("rejette un payload companies hors bornes avant toute requête DB", async () => {
    const res = await handleX402Companies(
      post({
        filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
        page_size: 999,
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(queryX402Companies).not.toHaveBeenCalled();
  });

  it("autorise les contacts pro publics bornés sur companies", async () => {
    queryX402Companies.mockResolvedValueOnce({
      rows: [{ siren: "451556062", denomination: "CCDD", email: "contact@example.fr", phone: "+33400000000" }],
      totalExact: 1,
      totalIsCapped: false,
    });

    const res = await handleX402Companies(
      post({
        filters: { all: [{ field: "email", op: "exists", value: true }] },
        fields: ["siren", "denomination", "email", "phone"],
        page_size: 10,
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ email: "contact@example.fr", phone: "+33400000000" });
    expect(body.page_size).toBe(10);
    expect(queryX402Companies).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: ["siren", "denomination", "email", "phone"],
        page: 1,
        pageSize: 10,
      }),
    );
  });

  it("refuse la projection de champs dirigeant/personne non publiée", async () => {
    const res = await handleX402Companies(
      post({
        filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
        fields: ["siren", "dirigeant_nom"],
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unknown fields: dirigeant_nom" });
    expect(queryX402Companies).not.toHaveBeenCalled();
  });

  it("refuse les filtres contact non-exists sur companies x402", async () => {
    const res = await handleX402Companies(
      post({
        filters: { all: [{ field: "email", op: "contains", value: "@example.com" }] },
        fields: ["siren", "denomination"],
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unsupported x402 contact filter operators: email:contains" });
    expect(queryX402Companies).not.toHaveBeenCalled();
  });
});
