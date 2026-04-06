/**
 * End-to-end tests for the /api/admin/* routes.
 *
 * Requires:
 *  - Next dev server running at APP_URL (default http://localhost:3000)
 *  - A seeded tenant with workspaces (run scripts/seed-staging-demo.ts first)
 *  - Supabase staging creds (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_*)
 *
 * Authenticates as robert@veridian.site via magic link exchange, crafts a
 * @supabase/ssr-compatible cookie, then curls each admin route.
 *
 * Run: npx vitest run e2e/integration/admin-routes.test.ts
 *
 * Skipped automatically if APP_URL or Supabase creds are missing (CI flexibility).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.APP_URL || process.env.BASE_URL || "http://localhost:3000";
const TENANT_OWNER_EMAIL = "robert@veridian.site";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const shouldSkip = !supabaseUrl || !serviceKey || !anonKey;

let cookieHeader = "";
let pickedWorkspaceId: string | undefined;
let pickedWorkspaceName: string | undefined;

async function hit(method: string, path: string, body?: object) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // no body
  }
  return { status: res.status, body: payload };
}

beforeAll(async () => {
  if (shouldSkip) return;

  const admin = createClient(supabaseUrl!, serviceKey!);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TENANT_OWNER_EMAIL,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? "no hashed_token"}`);
  }

  const client = createClient(supabaseUrl!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: sessionData, error: otpErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpErr || !sessionData?.session) {
    throw new Error(`verifyOtp failed: ${otpErr?.message ?? "no session"}`);
  }

  const projectRef = new URL(supabaseUrl!).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_in: sessionData.session.expires_in,
        expires_at: sessionData.session.expires_at,
        token_type: "bearer",
        user: sessionData.user,
      })
    ).toString("base64");
  cookieHeader = `${cookieName}=${cookieValue}`;
}, 30_000);

describe.skipIf(shouldSkip)("Admin routes (/api/admin/*)", () => {
  describe("GET /api/admin/workspaces", () => {
    it("returns 200 and a list of workspaces", async () => {
      const res = await hit("GET", "/api/admin/workspaces");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      const list = res.body as Array<{ id: string; name: string; slug: string; memberCount: number }>;
      expect(list.length).toBeGreaterThanOrEqual(1);
      for (const ws of list) {
        expect(ws.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(typeof ws.name).toBe("string");
        expect(typeof ws.slug).toBe("string");
        expect(typeof ws.memberCount).toBe("number");
      }
      // Pick the first workspace for downstream tests
      pickedWorkspaceId = list[0].id;
      pickedWorkspaceName = list[0].name;
    });
  });

  describe("POST /api/admin/workspaces", () => {
    it("creates a new workspace with auto slug", async () => {
      const name = `Vitest-${Date.now()}`;
      const res = await hit("POST", "/api/admin/workspaces", { name });
      expect(res.status).toBe(201);
      const ws = res.body as { id: string; name: string; slug: string };
      expect(ws.name).toBe(name);
      expect(ws.slug).toMatch(/^vitest-/);

      // Cleanup
      await hit("DELETE", `/api/admin/workspaces/${ws.id}`);
    });

    it("rejects empty name with 400", async () => {
      const res = await hit("POST", "/api/admin/workspaces", { name: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/workspaces/[id]", () => {
    it("renames the workspace and returns 200", async () => {
      if (!pickedWorkspaceId || !pickedWorkspaceName) return;
      const res = await hit("PATCH", `/api/admin/workspaces/${pickedWorkspaceId}`, {
        name: pickedWorkspaceName, // no-op rename
      });
      expect(res.status).toBe(200);
      const body = res.body as { id: string; name: string };
      expect(body.id).toBe(pickedWorkspaceId);
      expect(body.name).toBe(pickedWorkspaceName);
    });
  });

  describe("GET /api/admin/members", () => {
    it("returns the list of tenant members with roles", async () => {
      const res = await hit("GET", "/api/admin/members");
      expect(res.status).toBe(200);
      const body = res.body as { members: Array<{ userId: string; email: string; memberships: unknown[] }> };
      expect(Array.isArray(body.members)).toBe(true);
      expect(body.members.length).toBeGreaterThanOrEqual(1);
      for (const m of body.members) {
        expect(typeof m.userId).toBe("string");
        expect(typeof m.email).toBe("string");
        expect(Array.isArray(m.memberships)).toBe(true);
      }
    });
  });

  describe("POST /api/admin/invites", () => {
    it("generates a magic link for a new email", async () => {
      if (!pickedWorkspaceId) return;
      const email = `vitest-invite-${Date.now()}@demo.veridian.site`;
      const res = await hit("POST", "/api/admin/invites", {
        email,
        workspaceId: pickedWorkspaceId,
        role: "member",
      });
      expect(res.status).toBe(201);
      const body = res.body as { inviteUrl: string; token: string; email: string };
      expect(body.inviteUrl).toContain("/invite/");
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(body.email).toBe(email);
    });

    it("rejects invalid email with 400", async () => {
      if (!pickedWorkspaceId) return;
      const res = await hit("POST", "/api/admin/invites", {
        email: "not-an-email",
        workspaceId: pickedWorkspaceId,
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing workspaceId with 400", async () => {
      const res = await hit("POST", "/api/admin/invites", {
        email: "foo@bar.com",
      });
      expect(res.status).toBe(400);
    });

    it("rejects workspaceId from another tenant with 404", async () => {
      const res = await hit("POST", "/api/admin/invites", {
        email: "foo@bar.com",
        workspaceId: "00000000-0000-0000-0000-000000000000", // fake UUID
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/admin/invites", () => {
    it("returns the list of pending invites", async () => {
      const res = await hit("GET", "/api/admin/invites");
      expect(res.status).toBe(200);
      const body = res.body as { invites: unknown[] };
      expect(Array.isArray(body.invites)).toBe(true);
    });
  });

  describe("GET /invite/[token] (public page)", () => {
    it("shows the accept page for a valid token", async () => {
      if (!pickedWorkspaceId) return;
      // Create a fresh invite
      const inviteRes = await hit("POST", "/api/admin/invites", {
        email: `vitest-page-${Date.now()}@demo.veridian.site`,
        workspaceId: pickedWorkspaceId,
        role: "member",
      });
      expect(inviteRes.status).toBe(201);
      const invBody = inviteRes.body as { token: string };

      // Fetch the public page without any cookie
      const pageRes = await fetch(`${APP_URL}/invite/${invBody.token}`);
      expect(pageRes.status).toBe(200);
      const html = await pageRes.text();
      // The page should contain either "Invitation" or a login CTA
      const hasAnyMarker =
        html.includes("Invitation") ||
        html.includes("Me connecter") ||
        html.includes("rejoindre");
      expect(hasAnyMarker).toBe(true);
    });

    it("shows an invalid page for an unknown token", async () => {
      const pageRes = await fetch(`${APP_URL}/invite/COMPLETELY_INVALID_TOKEN_XYZ_123`);
      expect(pageRes.status).toBe(200); // page renders, not 404
      const html = await pageRes.text();
      expect(html.toLowerCase()).toMatch(/invalid|invalide/);
    });
  });

  describe("GET /api/admin/kpi", () => {
    it("returns aggregated KPIs per workspace", async () => {
      const res = await hit("GET", "/api/admin/kpi");
      expect(res.status).toBe(200);
      const body = res.body as {
        tenantId: string;
        workspaces: Array<{
          workspaceId: string;
          name: string;
          outreach: { total: number; byStatus: Record<string, number>; won: number; conversionRate: number };
          calls: { total: number; totalSeconds: number };
          followups: { total: number; byStatus: Record<string, number> };
        }>;
      };
      expect(body.tenantId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.workspaces.length).toBeGreaterThanOrEqual(1);
      for (const w of body.workspaces) {
        expect(typeof w.outreach.total).toBe("number");
        expect(typeof w.outreach.won).toBe("number");
        expect(typeof w.outreach.conversionRate).toBe("number");
        expect(typeof w.calls.total).toBe("number");
        expect(typeof w.followups.total).toBe("number");
      }
    });
  });
});

describe.skipIf(shouldSkip)("Entreprises routes (/api/entreprises/*)", () => {
  it("GET /api/entreprises returns paginated results", async () => {
    const res = await hit("GET", "/api/entreprises?limit=5");
    expect(res.status).toBe(200);
    const body = res.body as {
      total: number;
      rows: Array<{ siren: string; denomination: string; prospectScore: number }>;
      limit: number;
      offset: number;
    };
    expect(body.total).toBeGreaterThan(900_000);
    expect(body.rows).toHaveLength(5);
    expect(body.limit).toBe(5);
    // Top row should be a diamond (score >= 95)
    expect(body.rows[0].prospectScore).toBeGreaterThanOrEqual(95);
  });

  it("GET /api/entreprises supports filters (dept + rge + has_phone)", async () => {
    const res = await hit("GET", "/api/entreprises?departement=69&rge=true&has_phone=true&limit=10");
    expect(res.status).toBe(200);
    const body = res.body as { rows: Array<{ departement: string; estRge: boolean; bestPhoneE164: string | null }> };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      expect(r.departement).toBe("69");
      expect(r.estRge).toBe(true);
      expect(r.bestPhoneE164).not.toBeNull();
    }
  });

  it("GET /api/entreprises supports fuzzy search", async () => {
    const res = await hit("GET", "/api/entreprises?q=OXALIS&limit=5");
    expect(res.status).toBe(200);
    const body = res.body as { rows: Array<{ denomination: string }> };
    expect(body.rows.some((r) => r.denomination?.toUpperCase().includes("OXALIS"))).toBe(true);
  });

  it("GET /api/entreprises/[siren] returns fiche for known SIREN", async () => {
    // POLLEN SCOP is a known diamond prospect in the seed
    const res = await hit("GET", "/api/entreprises/439076563");
    expect(res.status).toBe(200);
    const body = res.body as { siren: string; denomination: string; estRge: boolean; prospectScore: number };
    expect(body.siren).toBe("439076563");
    expect(body.denomination).toBe("POLLEN SCOP");
    expect(body.estRge).toBe(true);
    expect(body.prospectScore).toBe(100);
  });

  it("GET /api/entreprises/abc returns 400 (bad siren format)", async () => {
    const res = await hit("GET", "/api/entreprises/abc");
    expect(res.status).toBe(400);
  });

  it("GET /api/entreprises/999999999 returns 404 (unknown SIREN)", async () => {
    const res = await hit("GET", "/api/entreprises/999999999");
    expect(res.status).toBe(404);
  });

  it("GET /api/entreprises/segments returns the catalog", async () => {
    const res = await hit("GET", "/api/entreprises/segments");
    expect(res.status).toBe(200);
    const body = res.body as { segments: Array<{ id: string; viewName: string; volume: number }> };
    expect(body.segments.length).toBeGreaterThanOrEqual(20);
    expect(body.segments.some((s) => s.id === "S01")).toBe(true);
    expect(body.segments.some((s) => s.id === "DIAMOND")).toBe(true);
  });

  it("GET /api/entreprises/segments/S01 returns paginated rows (RGE sans site)", async () => {
    const res = await hit("GET", "/api/entreprises/segments/S01?limit=5");
    expect(res.status).toBe(200);
    const body = res.body as {
      id: string;
      rows: Array<{ siren: string; est_rge: boolean; web_domain_normalized: string | null }>;
    };
    expect(body.id).toBe("S01");
    expect(body.rows).toHaveLength(5);
    // All S01 rows must be RGE without a website
    for (const r of body.rows) {
      expect(r.est_rge).toBe(true);
      expect(r.web_domain_normalized).toBeNull();
    }
  });

  it("GET /api/entreprises/segments/XYZ_INVALID returns 404", async () => {
    const res = await hit("GET", "/api/entreprises/segments/XYZ_INVALID");
    expect(res.status).toBe(404);
  });

  // Sub-routes for SIREN-specific operations are still stubs (outreach, claude FK refactor)
  it("GET /api/entreprises/[siren]/outreach returns 501", async () => {
    const res = await hit("GET", "/api/entreprises/123456789/outreach");
    expect(res.status).toBe(501);
  });

  it("GET /api/entreprises/[siren]/claude returns 501", async () => {
    const res = await hit("GET", "/api/entreprises/123456789/claude");
    expect(res.status).toBe(501);
  });
});

describe.skipIf(shouldSkip)("Legacy routes (regression after workspace filter)", () => {
  it("GET /api/followups still returns 200 with auth", async () => {
    const res = await hit("GET", "/api/followups");
    expect(res.status).toBe(200);
  });

  it("GET /api/pipeline still returns 200 with auth", async () => {
    const res = await hit("GET", "/api/pipeline");
    expect(res.status).toBe(200);
  });

  it("GET /api/claude/example.com still returns 200", async () => {
    const res = await hit("GET", "/api/claude/example.com");
    expect(res.status).toBe(200);
  });

  it("GET /api/health returns 200", async () => {
    const res = await hit("GET", "/api/health");
    expect(res.status).toBe(200);
  });
});
