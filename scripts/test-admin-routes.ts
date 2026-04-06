/**
 * End-to-end test for the admin routes.
 *
 * Flow:
 *  1. Use the Supabase admin API to generate a magic link for robert@veridian.site
 *  2. Exchange the hashed_token for a session (access_token + refresh_token)
 *  3. Build a cookie in the @supabase/ssr format and curl the admin routes
 *  4. Assert each route returns the expected status and payload shape
 *
 * Usage (from the dev server or locally with staging creds):
 *   DATABASE_URL=... \
 *   SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   NEXT_PUBLIC_SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   APP_URL=http://localhost:3000 \
 *   npx tsx scripts/test-admin-routes.ts
 */
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const TENANT_OWNER_EMAIL = "robert@veridian.site";

type Assertion = { name: string; ok: boolean; details?: string };
const assertions: Assertion[] = [];

function assert(name: string, cond: boolean, details?: string) {
  assertions.push({ name, ok: cond, details });
  console.log(`${cond ? "✓" : "✗"} ${name}${details ? ` — ${details}` : ""}`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY required");
  }

  // 1) Generate a magiclink via admin API
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TENANT_OWNER_EMAIL,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? "no hashed_token"}`);
  }

  // 2) Verify the OTP to get a session
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: sessionData, error: otpErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpErr || !sessionData?.session) {
    throw new Error(`verifyOtp failed: ${otpErr?.message ?? "no session"}`);
  }

  console.log(`✓ Session for ${TENANT_OWNER_EMAIL} (user id: ${sessionData.user?.id})`);

  // 3) Build the auth cookie in @supabase/ssr format
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = "base64-" + Buffer.from(
    JSON.stringify({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      expires_in: sessionData.session.expires_in,
      expires_at: sessionData.session.expires_at,
      token_type: "bearer",
      user: sessionData.user,
    })
  ).toString("base64");
  const cookieHeader = `${cookieName}=${cookieValue}`;

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
    try { payload = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: payload };
  }

  // --- Admin routes ---
  const ws = await hit("GET", "/api/admin/workspaces");
  assert("GET /api/admin/workspaces → 200", ws.status === 200, `status=${ws.status}`);
  const workspaces = Array.isArray(ws.body) ? ws.body as Array<{ id: string; name: string }> : [];
  assert("workspaces count = 3", workspaces.length === 3, `got=${workspaces.length}`);
  const names = workspaces.map((w) => w.name).sort().join(",");
  assert("workspaces are Lyon,Marseille,Paris", names === "Lyon,Marseille,Paris", `got="${names}"`);

  const members = await hit("GET", "/api/admin/members");
  assert("GET /api/admin/members → 200", members.status === 200, `status=${members.status}`);
  const memberList = (members.body as { members?: unknown[] })?.members ?? [];
  assert("members count ≥ 4 (robert + 3 sales)", memberList.length >= 4, `got=${memberList.length}`);

  const kpi = await hit("GET", "/api/admin/kpi");
  assert("GET /api/admin/kpi → 200", kpi.status === 200, `status=${kpi.status}`);
  const kpiBody = kpi.body as { workspaces?: Array<{ name: string; outreach?: { total: number; byStatus?: Record<string, number> } }> };
  const kpiWs = kpiBody?.workspaces ?? [];
  assert("KPI workspaces count = 3", kpiWs.length === 3, `got=${kpiWs.length}`);
  const totalOutreach = kpiWs.reduce((a, w) => a + (w.outreach?.total ?? 0), 0);
  assert("KPI total outreach = 26 (seed)", totalOutreach === 26, `got=${totalOutreach}`);
  const allStatuses = new Set<string>();
  for (const w of kpiWs) for (const s of Object.keys(w.outreach?.byStatus ?? {})) allStatuses.add(s);
  assert("KPI has ≥3 distinct statuses", allStatuses.size >= 3, `got=${allStatuses.size} (${[...allStatuses].join(",")})`);

  const pickedWs = workspaces[0];
  if (pickedWs) {
    const invite = await hit("POST", "/api/admin/invites", {
      email: `test-invite-${Date.now()}@demo.veridian.site`,
      workspaceId: pickedWs.id,
      role: "member",
    });
    assert("POST /api/admin/invites → 201", invite.status === 201, `status=${invite.status}`);
    const invBody = invite.body as { inviteUrl?: string; token?: string };
    assert("invite has inviteUrl+token", !!invBody?.inviteUrl && !!invBody?.token);

    const patch = await hit("PATCH", `/api/admin/workspaces/${pickedWs.id}`, { name: pickedWs.name });
    assert("PATCH /api/admin/workspaces/[id] → 200", patch.status === 200, `status=${patch.status}`);
  }

  // --- Entreprises stubs ---
  const entList = await hit("GET", "/api/entreprises");
  assert("GET /api/entreprises → 501 (stub)", entList.status === 501, `status=${entList.status}`);

  const entDetail = await hit("GET", "/api/entreprises/123456789");
  assert("GET /api/entreprises/[siren] → 501 (stub)", entDetail.status === 501, `status=${entDetail.status}`);

  const entBad = await hit("GET", "/api/entreprises/abc");
  assert("GET /api/entreprises/abc → 400 (bad siren)", entBad.status === 400, `status=${entBad.status}`);

  // --- Legacy route still works (regression) ---
  const followups = await hit("GET", "/api/followups");
  assert("GET /api/followups → 200 (auth still works)", followups.status === 200, `status=${followups.status}`);

  const pipeline = await hit("GET", "/api/pipeline");
  assert("GET /api/pipeline → 200", pipeline.status === 200, `status=${pipeline.status}`);

  console.log("\n=== SUMMARY ===");
  const passed = assertions.filter((a) => a.ok).length;
  const failed = assertions.filter((a) => !a.ok).length;
  console.log(`${passed}/${assertions.length} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailed:");
    for (const a of assertions.filter((a) => !a.ok)) {
      console.log(`  ✗ ${a.name}${a.details ? ` — ${a.details}` : ""}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
