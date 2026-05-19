/**
 * Tests pour `src/lib/hub/auth.ts:requireHubHmac` — middleware HMAC pour les
 * nouvelles routes contrat §5 (attach-owner, suspend, resume, health, etc.).
 */
import { describe, expect, test, vi } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-auth-secret";
  process.env.ACCEPT_LEGACY_BEARER = "1";
});

import { requireHubHmac } from "@/lib/hub/auth";
import { makeRequest, readJson } from "../../api/_helpers";

const SECRET = "test-auth-secret";

function standardHeaders(rawBody: string): Record<string, string> {
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return {
    "x-veridian-timestamp": String(ts),
    "x-veridian-hub-signature": sig,
  };
}

describe("requireHubHmac", () => {
  test("accepte HMAC standard et retourne body parsé", async () => {
    const bodyObj = { tenant_id: "t-1", action: "suspend" };
    const raw = JSON.stringify(bodyObj);
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: standardHeaders(raw),
      body: raw,
    });
    const r = await requireHubHmac<typeof bodyObj>(req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toEqual(bodyObj);
      expect(r.mode).toBe("standard");
    }
  });

  test("rejette signature invalide en 401", async () => {
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
      body: raw,
    });
    const r = await requireHubHmac(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      const body = (await readJson(r.response)) as { error: string };
      expect(body.error).toBe("Invalid signature");
    }
  });

  test("rejette drift timestamp > 5min", async () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": sig,
      },
      body: raw,
    });
    const r = await requireHubHmac(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      const body = (await readJson(r.response)) as { error: string };
      expect(body.error).toBe("Timestamp expired or invalid");
    }
  });

  test("rejette body JSON invalide en 400", async () => {
    const raw = "not-json-at-all-{";
    const sig = createHmac("sha256", SECRET).update(`${Date.now()}.${raw}`).digest("hex");
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": sig,
      },
      body: raw,
    });
    const r = await requireHubHmac(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const body = (await readJson(r.response)) as { error: string };
      expect(body.error).toBe("invalid_payload");
    }
  });

  test("accepte legacy Bearer (ACCEPT_LEGACY_BEARER=1)", async () => {
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: raw,
    });
    const r = await requireHubHmac(req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("legacy_bearer");
  });

  test("rejette si ni HMAC ni Bearer fournis", async () => {
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      body: JSON.stringify({ tenant_id: "t-1" }),
    });
    const r = await requireHubHmac(req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
});
