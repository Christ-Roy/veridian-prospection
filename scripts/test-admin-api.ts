#!/usr/bin/env npx tsx
/**
 * API smoke test for admin endpoints.
 * Run: APP_URL=http://100.92.215.42:3000 npx tsx scripts/test-admin-api.ts
 */

const APP_URL = process.env.APP_URL || "http://100.92.215.42:3000";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

let passed = 0, failed = 0;

function assert(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
}

async function getToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  return data.access_token || "";
}

async function api(path: string, token: string) {
  const res = await fetch(`${APP_URL}${path}`, {
    headers: { Cookie: `sb-api-auth-token=${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  console.log(`\n🔍 Admin API smoke test against ${APP_URL}\n`);

  const token = await getToken();
  assert("Login", !!token);
  if (!token) { process.exit(1); }

  // /api/me
  const me = await api("/api/me", token);
  assert("/api/me returns 200", me.status === 200);
  assert("/api/me has userId", !!me.body?.userId);
  assert("/api/me has isAdmin", me.body?.isAdmin !== undefined);

  // /api/admin/members
  const members = await api("/api/admin/members", token);
  assert("/api/admin/members returns 200", members.status === 200);
  assert("members has array", Array.isArray(members.body?.members));

  // /api/admin/workspaces
  const ws = await api("/api/admin/workspaces", token);
  assert("/api/admin/workspaces returns 200", ws.status === 200);

  // /api/admin/invitations
  const inv = await api("/api/admin/invitations", token);
  assert("/api/admin/invitations returns 200", inv.status === 200);

  // /api/stats/overview
  const stats = await api("/api/stats/overview", token);
  assert("/api/stats/overview returns 200", stats.status === 200);
  assert("stats has entreprises", !!stats.body?.entreprises);

  // /api/trial
  const trial = await api("/api/trial", token);
  assert("/api/trial returns 200", trial.status === 200);
  assert("trial has daysLeft", trial.body?.daysLeft !== undefined);

  // /api/changelog (no auth needed)
  const cl = await fetch(`${APP_URL}/api/changelog`);
  const clb = await cl.json();
  assert("/api/changelog returns commits", Array.isArray(clb.commits));

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
export {};
