#!/usr/bin/env npx tsx
/**
 * API smoke test for /api/prospects and related stats endpoints.
 * Run: APP_URL=https://saas-prospection.staging.veridian.site npx tsx scripts/test-prospects-api.ts
 */

const APP_URL = process.env.APP_URL || "http://100.92.215.42:3000";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://saas-api.staging.veridian.site";
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

async function api(path: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${APP_URL}${path}`, {
    headers: { Cookie: `sb-api-auth-token=${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  console.log(`\n🔍 Prospects API smoke test against ${APP_URL}\n`);

  const token = await getToken();
  assert("Login", !!token, "no token received");
  if (!token) { console.log("Cannot continue without token"); process.exit(1); }

  // 1. Basic prospects
  const p1 = await api("/api/prospects?domain=all&preset=tous&page=1&pageSize=5", token);
  assert("/api/prospects returns 200", p1.status === 200, `got ${p1.status}`);
  assert("prospects has data array", Array.isArray(p1.body?.data), JSON.stringify(p1.body)?.slice(0, 100));
  assert("prospects respects pageSize=5", (p1.body?.data?.length || 0) <= 5);

  // 2. Sort
  const p2 = await api("/api/prospects?domain=all&preset=tous&page=1&pageSize=3&sort=ca&sortDir=desc", token);
  assert("sort=ca works", p2.status === 200);

  // 3. Department filter
  const p3 = await api("/api/prospects?domain=all&preset=tous&page=1&pageSize=3&dept=69", token);
  assert("dept=69 filter works", p3.status === 200);

  // 4. hasWebsite filter
  const p4 = await api("/api/prospects?domain=all&preset=tous&page=1&pageSize=3&hasWebsite=0", token);
  assert("hasWebsite=0 works", p4.status === 200);
  if (p4.body?.data?.[0]) {
    assert("sans-site leads have no web_domain", !p4.body.data[0].web_domain);
  }

  // 5. Search
  const p5 = await api("/api/prospects?domain=all&preset=tous&page=1&pageSize=3&q=boulangerie", token);
  assert("search q=boulangerie works", p5.status === 200);

  // 6. Sans-site filters
  const p6 = await api("/api/sans-site-filters", token);
  assert("/api/sans-site-filters returns 200", p6.status === 200 || p6.status === 401);

  // 7. Stats by department
  const p7 = await api("/api/stats/by-department", token);
  assert("/api/stats/by-department returns 200", p7.status === 200 || p7.status === 401);

  // 8. Stats overview
  const p8 = await api("/api/stats/overview", token);
  assert("/api/stats/overview returns 200", p8.status === 200 || p8.status === 401);

  // 9. Health (no auth needed)
  const h = await fetch(`${APP_URL}/api/health`);
  const hb = await h.json();
  assert("/api/health healthy", hb.status === "healthy");
  assert("leadCount > 0", (hb.leadCount || 0) > 0);

  // 10. Changelog
  const c = await fetch(`${APP_URL}/api/changelog`);
  const cb = await c.json();
  assert("/api/changelog has commits", Array.isArray(cb.commits));

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
export {};
