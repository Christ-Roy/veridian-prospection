/**
 * Tests de la route POST /api/errors (client-side error reporting).
 *
 * Couvre :
 *  - 200 sur payload valide
 *  - 400 sur body JSON invalide
 *  - 429 après 10 reports/minute pour la même IP
 */
import { describe, expect, test, beforeEach, vi } from "vitest";

import { POST } from "@/app/api/errors/route";
import { makeRequest, readJson } from "./_helpers";

describe("POST /api/errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("accepts a well-formed error report (200 ok)", async () => {
    const req = makeRequest("/api/errors", {
      method: "POST",
      headers: { "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 250)}` },
      body: {
        message: "Boom",
        stack: "Error: Boom\n  at foo",
        url: "https://app.veridian.site/x",
        userAgent: "Mozilla/5.0",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("returns 400 on invalid JSON body", async () => {
    const req = makeRequest("/api/errors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `2.3.4.${Math.floor(Math.random() * 250)}`,
      },
      body: "{not json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test("rate-limits to 10 reports per minute per IP (11th returns 429)", async () => {
    // IP fixe et unique pour ce test → on n'interfère pas avec les autres
    const ip = `9.9.9.${Math.floor(Math.random() * 250)}`;
    const send = () =>
      POST(
        makeRequest("/api/errors", {
          method: "POST",
          headers: { "x-forwarded-for": ip },
          body: { message: "tick" },
        }),
      );

    for (let i = 0; i < 10; i++) {
      const r = await send();
      expect(r.status).toBe(200);
    }
    const r11 = await send();
    expect(r11.status).toBe(429);
    const body = (await readJson(r11)) as { ok: boolean; reason: string };
    expect(body.reason).toBe("rate_limited");
  });
});
