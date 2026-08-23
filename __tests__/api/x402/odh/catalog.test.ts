import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/x402/odh/catalog/route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("GET /api/x402/odh/catalog", () => {
  it("publie un parcours agent borne seulement quand x402 est active", async () => {
    delete process.env.X402_ENABLED;
    expect((await GET()).status).toBe(404);

    process.env.X402_ENABLED = "1";
    process.env.X402_NETWORK = "eip155:84532";
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recommended_flow).toEqual(["catalog", "estimate", "companies"]);
    expect(body.limits.page_size_max).toBe(50);
    expect(body.endpoints.map((endpoint: { path: string }) => endpoint.path)).toEqual([
      "/api/x402/odh/estimate",
      "/api/x402/odh/companies",
    ]);
    expect(body.fields.find((field: { name: string }) => field.name === "email").operators).toEqual(["exists"]);
  });
});
