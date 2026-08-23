import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/x402/odh/estimate/route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/x402/odh/estimate", () => {
  it("reste ferme avant activation explicite", async () => {
    delete process.env.X402_ENABLED;
    const request = new Request("https://example.test/api/x402/odh/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters: { all: [] } }),
    });
    expect((await POST(request as never)).status).toBe(404);
  });
});
