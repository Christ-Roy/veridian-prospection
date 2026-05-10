/**
 * Unit tests for /api/tenants/magic-link.
 *
 * Mocks @supabase/supabase-js so no network is touched. Covers HMAC
 * verification, drift, missing tenant, success path with token rotation, and
 * idempotence (two calls = two distinct tokens).
 *
 * Run: npx vitest run src/app/api/tenants/magic-link/route.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

const TEST_SECRET = "test-secret-magic-link-2026";
process.env.TENANT_API_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
process.env.APP_URL = "https://prospection.test";

// Mock state — reset in beforeEach
type MockState = {
  users: { id: string; email: string }[];
  tenants: Record<string, { id: string; user_id: string; prospection_login_token?: string | null; prospection_login_token_created_at?: string | null; prospection_login_token_used?: boolean }>;
  updates: { id: string; payload: Record<string, unknown> }[];
  listUsersError: string | null;
};

const state: MockState = {
  users: [],
  tenants: {},
  updates: [],
  listUsersError: null,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      admin: {
        listUsers: vi.fn(async () => {
          if (state.listUsersError) {
            return { data: null, error: { message: state.listUsersError } };
          }
          return { data: { users: state.users }, error: null };
        }),
      },
    },
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            const tenant = Object.values(state.tenants).find(
              (t) => (t as Record<string, unknown>)[col] === val,
            );
            return { data: tenant ?? null, error: null };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, val: string) => {
          const tenant = state.tenants[val];
          if (tenant) {
            Object.assign(tenant, payload);
            state.updates.push({ id: val, payload });
          }
          return { error: null };
        },
      }),
    }),
  }),
}));

function sign(tenantId: string, ts: number): string {
  return createHmac("sha256", TEST_SECRET).update(`${tenantId}:${ts}`).digest("hex");
}

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://prospection.test/api/tenants/magic-link", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// Import the route AFTER mocks are set up
async function loadRoute() {
  const mod = await import("./route");
  return mod.POST;
}

describe("POST /api/tenants/magic-link", () => {
  beforeEach(() => {
    state.users = [
      { id: "user-uuid-1", email: "alice@example.com" },
      { id: "user-uuid-2", email: "bob@example.com" },
    ];
    state.tenants = {
      "tenant-uuid-alice": {
        id: "tenant-uuid-alice",
        user_id: "user-uuid-1",
        prospection_login_token: "old-token",
        prospection_login_token_used: true,
      },
    };
    state.updates = [];
    state.listUsersError = null;
  });

  it("returns 400 when tenant_id missing", async () => {
    const POST = await loadRoute();
    const res = await POST(makeReq({ timestamp: Date.now(), signature: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 on expired timestamp drift", async () => {
    const POST = await loadRoute();
    const stale = Date.now() - 10 * 60 * 1000;
    const res = await POST(
      makeReq({
        tenant_id: "alice@example.com",
        timestamp: stale,
        signature: sign("alice@example.com", stale),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on invalid signature", async () => {
    const POST = await loadRoute();
    const ts = Date.now();
    const res = await POST(
      makeReq({
        tenant_id: "alice@example.com",
        timestamp: ts,
        signature: "deadbeef".repeat(8),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when email is unknown", async () => {
    const POST = await loadRoute();
    const ts = Date.now();
    const res = await POST(
      makeReq({
        tenant_id: "ghost@example.com",
        timestamp: ts,
        signature: sign("ghost@example.com", ts),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when user exists but tenant row missing", async () => {
    const POST = await loadRoute();
    const ts = Date.now();
    // bob has a Supabase user but no tenants row
    const res = await POST(
      makeReq({
        tenant_id: "bob@example.com",
        timestamp: ts,
        signature: sign("bob@example.com", ts),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rotates token, resets used flag, returns login_url + expires_at on success", async () => {
    const POST = await loadRoute();
    const ts = Date.now();
    const res = await POST(
      makeReq({
        tenant_id: "alice@example.com",
        timestamp: ts,
        signature: sign("alice@example.com", ts),
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { login_url: string; expires_at: string };
    expect(data.login_url).toMatch(
      /^https:\/\/prospection\.test\/api\/auth\/token\?t=[a-f0-9]{64}$/,
    );
    expect(new Date(data.expires_at).getTime()).toBeGreaterThan(Date.now());

    // DB state: token rewritten, used reset to false
    const tenant = state.tenants["tenant-uuid-alice"];
    expect(tenant.prospection_login_token).toMatch(/^[a-f0-9]{64}$/);
    expect(tenant.prospection_login_token).not.toBe("old-token");
    expect(tenant.prospection_login_token_used).toBe(false);
    expect(state.updates).toHaveLength(1);
  });

  it("is idempotent — two consecutive calls produce distinct fresh tokens", async () => {
    const POST = await loadRoute();
    const ts1 = Date.now();
    const r1 = await POST(
      makeReq({
        tenant_id: "alice@example.com",
        timestamp: ts1,
        signature: sign("alice@example.com", ts1),
      }),
    );
    const d1 = (await r1.json()) as { login_url: string };
    const token1 = new URL(d1.login_url).searchParams.get("t");

    const ts2 = Date.now() + 1;
    const r2 = await POST(
      makeReq({
        tenant_id: "alice@example.com",
        timestamp: ts2,
        signature: sign("alice@example.com", ts2),
      }),
    );
    const d2 = (await r2.json()) as { login_url: string };
    const token2 = new URL(d2.login_url).searchParams.get("t");

    expect(token1).toBeTruthy();
    expect(token2).toBeTruthy();
    expect(token1).not.toBe(token2);
    // Last write wins
    expect(state.tenants["tenant-uuid-alice"].prospection_login_token).toBe(token2);
  });

  it("returns 500 when listUsers fails (Supabase down)", async () => {
    const POST = await loadRoute();
    state.listUsersError = "Supabase exploded";
    const ts = Date.now();
    const res = await POST(
      makeReq({
        tenant_id: "alice@example.com",
        timestamp: ts,
        signature: sign("alice@example.com", ts),
      }),
    );
    expect(res.status).toBe(500);
  });
});
