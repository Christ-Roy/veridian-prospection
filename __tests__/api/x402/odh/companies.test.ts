import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/x402/odh/companies/route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/x402/odh/companies", () => {
  it("reste ferme avant activation explicite", async () => {
    delete process.env.X402_ENABLED;
    delete process.env.X402_PUBLIC_BASE_URL;
    const request = new Request("https://example.test/api/x402/odh/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters: { all: [] } }),
    });
    expect((await POST(request as never)).status).toBe(404);
  });

  it("echoue clairement si l'activation est incomplete", async () => {
    process.env.X402_ENABLED = "1";
    delete process.env.X402_PUBLIC_BASE_URL;
    delete process.env.X402_NETWORK;
    delete process.env.X402_PAY_TO;
    const request = new Request("https://example.test/api/x402/odh/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters: { all: [] } }),
    });
    expect((await POST(request as never)).status).toBe(503);
  });
});
