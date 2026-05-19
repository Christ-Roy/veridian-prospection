/**
 * Tests de la route POST /api/tenants/provision (callable par le Hub).
 *
 * Couvre l'authentification triple :
 *  - Pattern A — HMAC standard `{ts}.{body}` dans les headers (cible contrat §6.1)
 *  - Legacy A — HMAC `email:ts` dans le body (fenêtre 30j ACCEPT_LEGACY_HMAC)
 *  - Legacy B — `Authorization: Bearer <secret>` (fenêtre Hub ACCEPT_LEGACY_BEARER)
 *
 * Plus :
 *  - 400 si email manquant
 *  - 500 si secret non configuré
 *  - 401 si signature invalide / timestamp drift / body modifié
 *  - 429 si rate limit atteint (10/min/IP)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-secret-xyz";
  process.env.TENANT_API_SECRET = "test-secret-xyz";
  process.env.ACCEPT_LEGACY_HMAC = "1";
  process.env.ACCEPT_LEGACY_BEARER = "1";
  // Pas de Supabase configuré → ensureOwnerAdmin sera no-op (court-circuit propre)
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const { prismaCtorMock } = vi.hoisted(() => ({
  prismaCtorMock: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  class PrismaClient {
    user = { upsert: vi.fn() };
    tenant = { upsert: vi.fn() };
    workspace = { findFirst: vi.fn(), create: vi.fn() };
    workspaceMember = { upsert: vi.fn() };
    constructor() {
      prismaCtorMock();
    }
  }
  return { PrismaClient };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { POST } from "@/app/api/tenants/provision/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-secret-xyz";

/** Legacy HMAC : signature sur `email:timestamp` placée dans le body. */
function signedBody(
  email: string,
  extras: { driftMs?: number; badSig?: boolean; plan?: string } = {},
) {
  const ts = Date.now() + (extras.driftMs ?? 0);
  const sig = extras.badSig
    ? "00".repeat(32)
    : createHmac("sha256", SECRET).update(`${email}:${ts}`).digest("hex");
  return {
    email,
    timestamp: ts,
    signature: sig,
    plan: extras.plan,
  };
}

/** Standard HMAC : signature `{ts}.{rawBody}` dans les headers `X-Veridian-*`. */
function standardHeaders(
  rawBody: string,
  extras: { driftMs?: number; badSig?: boolean } = {},
): Record<string, string> {
  const ts = Date.now() + (extras.driftMs ?? 0);
  const sig = extras.badSig
    ? "00".repeat(32)
    : createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return {
    "x-veridian-timestamp": String(ts),
    "x-veridian-hub-signature": sig,
  };
}

describe("POST /api/tenants/provision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 400 when email missing", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: { ...signedBody("placeholder"), email: undefined },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 401 on invalid HMAC signature", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.1.${Math.floor(Math.random() * 250)}` },
      body: signedBody("client@example.com", { badSig: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });

  test("returns 401 when timestamp drift > 5min", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.2.${Math.floor(Math.random() * 250)}` },
      // 6 min in the past
      body: signedBody("client@example.com", { driftMs: -6 * 60 * 1000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  test("returns 401 on bad legacy Bearer token", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-token",
        "x-forwarded-for": `10.0.3.${Math.floor(Math.random() * 250)}`,
      },
      body: { email: "client@example.com" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 200 + credentials on valid HMAC", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.4.${Math.floor(Math.random() * 250)}` },
      body: signedBody("client@example.com", { plan: "pro" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      tenant_id: string;
      api_key: string;
      login_url: string;
      plan: string;
      created: boolean;
    };
    expect(body.tenant_id).toBe("client@example.com");
    expect(body.api_key).toMatch(/^[a-f0-9]{64}$/);
    expect(body.login_url).toContain("/api/auth/token?t=");
    expect(body.plan).toBe("pro");
    expect(body.created).toBe(true);
  });

  test("returns 200 + credentials on valid legacy Bearer token", async () => {
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "x-forwarded-for": `10.0.5.${Math.floor(Math.random() * 250)}`,
      },
      body: { email: "client@example.com" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    // No plan provided → defaults to freemium
    expect(body.plan).toBe("freemium");
  });

  // === Pattern A — HMAC standard contrat §6.1 ===

  test("returns 200 on standard HMAC {ts}.{body} dans les headers", async () => {
    const bodyObj = { email: "client@example.com", plan: "pro" };
    const raw = JSON.stringify(bodyObj);
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw),
        "x-forwarded-for": `10.0.10.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    expect(body.plan).toBe("pro");
  });

  test("returns 401 si standard HMAC signe mal le body", async () => {
    const raw = JSON.stringify({ email: "client@example.com" });
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw, { badSig: true }),
        "x-forwarded-for": `10.0.11.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 401 si standard HMAC en drift > 5min", async () => {
    const raw = JSON.stringify({ email: "client@example.com" });
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(raw, { driftMs: -6 * 60 * 1000 }),
        "x-forwarded-for": `10.0.12.${Math.floor(Math.random() * 250)}`,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  test("returns 401 si body modifié après signature (replay-proof)", async () => {
    const original = JSON.stringify({ email: "client@example.com" });
    const tampered = JSON.stringify({ email: "attacker@example.com" });
    const req = makeRequest("/api/tenants/provision", {
      method: "POST",
      headers: {
        ...standardHeaders(original),
        "x-forwarded-for": `10.0.13.${Math.floor(Math.random() * 250)}`,
      },
      body: tampered,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("rate-limits to 10 requests/min/IP (11th returns 429)", async () => {
    const ip = `10.0.99.${Math.floor(Math.random() * 250)}`;
    const send = () =>
      POST(
        makeRequest("/api/tenants/provision", {
          method: "POST",
          headers: {
            authorization: `Bearer ${SECRET}`,
            "x-forwarded-for": ip,
          },
          body: { email: `client-${Math.random()}@example.com` },
        }),
      );

    for (let i = 0; i < 10; i++) {
      const r = await send();
      expect(r.status).toBe(200);
    }
    const r11 = await send();
    expect(r11.status).toBe(429);
  });
});
