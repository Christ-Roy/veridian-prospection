import { beforeEach, describe, expect, it, vi } from "vitest";

const { withSearchTimeout } = vi.hoisted(() => ({ withSearchTimeout: vi.fn() }));

vi.mock("@/lib/search/exec", () => ({
  withSearchTimeout,
  isStatementTimeout: () => false,
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
  beforeEach(() => withSearchTimeout.mockReset());

  it("refuse les filtres exacts/contains contact sur estimate x402", async () => {
    const res = await handleX402Estimate(
      post({
        filters: { all: [{ field: "phone", op: "contains", value: "+33" }] },
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unsupported x402 contact filter operators: phone:contains" });
    expect(withSearchTimeout).not.toHaveBeenCalled();
  });

  it("masque les petits segments estimate pour éviter la ré-identification", async () => {
    withSearchTimeout.mockImplementationOnce(async (fn) =>
      fn(async () => [{ total: BigInt(3), with_phone: BigInt(1), with_email: BigInt(1), with_both: BigInt(0) }]),
    );

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

  it("rejette un payload companies hors bornes avant toute requête DB", async () => {
    const res = await handleX402Companies(
      post({
        filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
        page_size: 999,
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(withSearchTimeout).not.toHaveBeenCalled();
  });

  it("autorise les contacts pro publics bornés sur companies", async () => {
    const queue = [
      [{ siren: "451556062", denomination: "CCDD", email: "contact@example.fr", phone: "+33400000000" }],
      [{ c: BigInt(1) }],
    ];
    withSearchTimeout.mockImplementationOnce(async (fn) => fn(async () => queue.shift() ?? []));

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
    expect(withSearchTimeout).not.toHaveBeenCalled();
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
    expect(withSearchTimeout).not.toHaveBeenCalled();
  });
});
