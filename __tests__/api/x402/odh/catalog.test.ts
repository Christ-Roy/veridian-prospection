import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/x402/odh/catalog/route";
import { X402_ROUTE_PATHS } from "@/lib/x402/contract";

const originalEnv = { ...process.env };
const CANONICAL = "https://search-dev.staging.veridian.site";

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("GET /api/x402/odh/catalog", () => {
  it("reste invisible tant que x402 n'est pas active", async () => {
    delete process.env.X402_ENABLED;
    delete process.env.X402_PUBLIC_BASE_URL;
    const request = new Request("https://prospection.staging.veridian.site/api/x402/odh/catalog");
    expect((await GET(request as never)).status).toBe(404);
  });

  it("redirige une facade non-canonique vers le host x402 public", async () => {
    process.env.X402_ENABLED = "0";
    process.env.X402_PUBLIC_BASE_URL = CANONICAL;
    const request = new Request("https://prospection.staging.veridian.site/api/x402/odh/catalog?source=agent");

    const response = await GET(request as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${CANONICAL}/api/x402/odh/catalog?source=agent`);
  });

  it("publie un parcours agent borne quand x402 est active", async () => {
    process.env.X402_ENABLED = "1";
    process.env.X402_PUBLIC_BASE_URL = CANONICAL;
    process.env.X402_NETWORK = "eip155:84532";
    const request = new Request(`${CANONICAL}/api/x402/odh/catalog`);
    const response = await GET(request as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.canonical_origin).toBe(CANONICAL);
    expect(body.recommended_flow).toEqual(["catalog", "estimate", "companies"]);
    expect(body.limits.page_size_max).toBe(50);
    expect(body.endpoints.map((endpoint: { path: string }) => endpoint.path)).toEqual([
      `${CANONICAL}${X402_ROUTE_PATHS.estimate}`,
      `${CANONICAL}${X402_ROUTE_PATHS.companies}`,
    ]);
    expect(body.endpoints.map((endpoint: { routePath: string }) => endpoint.routePath)).toEqual([
      X402_ROUTE_PATHS.estimate,
      X402_ROUTE_PATHS.companies,
    ]);
    expect(body.fields.find((field: { name: string }) => field.name === "email").operators).toEqual(["exists"]);
  });
});
