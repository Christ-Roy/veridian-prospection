import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OdhClickHouseConfigError,
  getOdhClickHouseConfig,
  queryX402Companies,
  queryX402Estimate,
} from "./clickhouse";

const originalEnv = { ...process.env };

const validEnv = {
  ODH_CLICKHOUSE_URL: "http://clickhouse.test:8123",
  ODH_CLICKHOUSE_USER: "odh",
  ODH_CLICKHOUSE_PASSWORD: "secret",
  ODH_CLICKHOUSE_DATABASE: "odh",
  ODH_CLICKHOUSE_SEARCH_TABLE: "company_search_current",
  ODH_CLICKHOUSE_TIMEOUT_MS: "3000",
  ODH_CLICKHOUSE_MAX_ROWS_TO_READ: "12345",
  ODH_CLICKHOUSE_MAX_BYTES_TO_READ: "456789",
};

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

describe("x402 ClickHouse adapter", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...validEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("échoue fermé si le secret ClickHouse serveur manque", () => {
    delete process.env.ODH_CLICKHOUSE_PASSWORD;

    expect(() => getOdhClickHouseConfig()).toThrow(OdhClickHouseConfigError);
  });

  it("lit companies depuis la projection ClickHouse bornée et paramétrée", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('{"siren":"451556062","denomination":"CCDD","email":"contact@example.fr"}\n'))
      .mockResolvedValueOnce(jsonResponse('{"c":1}\n'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryX402Companies({
      filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
      fields: ["siren", "denomination", "email"],
      sort: { field: "prospect_score", dir: "desc" },
      page: 1,
      pageSize: 25,
    });

    expect(result).toEqual({
      rows: [{ siren: "451556062", denomination: "CCDD", email: "contact@example.fr" }],
      totalExact: 1,
      totalIsCapped: false,
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("readonly")).toBe("1");
    expect(url.searchParams.get("max_execution_time")).toBe("3");
    expect(url.searchParams.get("max_rows_to_read")).toBe("12345");
    expect(url.searchParams.get("max_bytes_to_read")).toBe("456789");
    expect(url.searchParams.get("param_p1")).toBe("69");
    expect(String(init.body)).toContain("FROM `odh`.`company_search_current` c");
    expect(String(init.body)).toContain("ORDER BY if(JSONHas");
    expect(String(init.body)).not.toContain("entreprises");
  });

  it("borne le comptage companies à 10001 lignes pour signaler un total capé", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(""))
      .mockResolvedValueOnce(jsonResponse('{"c":10001}\n'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryX402Companies({
      filters: { all: [{ field: "email", op: "exists", value: true }] },
      fields: ["siren"],
      page: 2,
      pageSize: 50,
    });

    expect(result.totalExact).toBeNull();
    expect(result.totalIsCapped).toBe(true);
    expect(String((fetchMock.mock.calls[1] as [URL, RequestInit])[1].body)).toContain("LIMIT 10001");
  });

  it("ne lance pas les ventilations estimate quand le segment est trop petit", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse('{"total":3,"with_phone":1,"with_email":1,"with_both":0}\n'),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await queryX402Estimate({
      all: [{ field: "departement", op: "eq", value: "69" }],
    });

    expect(result.suppressSmallSegment).toBe(true);
    expect(result.breakdown).toEqual({});
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
