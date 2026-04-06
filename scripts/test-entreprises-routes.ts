/**
 * Test the new /api/entreprises/* routes end-to-end with robert's session.
 *
 * Usage:
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-entreprises-routes.ts
 */
import { createClient } from "@supabase/supabase-js";

const APP_URL = process.env.APP_URL || "http://localhost:3000";

type Assertion = { name: string; ok: boolean; details?: string };
const assertions: Assertion[] = [];

function assert(name: string, cond: boolean, details?: string) {
  assertions.push({ name, ok: cond, details });
  console.log(`${cond ? "✓" : "✗"} ${name}${details ? ` — ${details}` : ""}`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // 1) Get robert session
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "robert@veridian.site",
  });
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: sessionData } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData!.properties!.hashed_token!,
  });
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = "base64-" + Buffer.from(JSON.stringify({
    access_token: sessionData!.session!.access_token,
    refresh_token: sessionData!.session!.refresh_token,
    expires_in: sessionData!.session!.expires_in,
    expires_at: sessionData!.session!.expires_at,
    token_type: "bearer",
    user: sessionData!.user,
  })).toString("base64");
  const cookie = `${cookieName}=${cookieValue}`;
  console.log(`✓ Session for robert@veridian.site`);

  async function hit(path: string) {
    const t = Date.now();
    const r = await fetch(`${APP_URL}${path}`, { headers: { Cookie: cookie } });
    const dt = Date.now() - t;
    let body: unknown = null;
    try { body = await r.json(); } catch { /* no body */ }
    return { status: r.status, body, ms: dt };
  }

  // --- GET /api/entreprises (list) ---
  const list = await hit("/api/entreprises?limit=5");
  assert("GET /api/entreprises → 200", list.status === 200, `status=${list.status} ${list.ms}ms`);
  const listBody = list.body as { total: number; rows: Array<{ siren: string; denomination: string; prospectScore: number; isRegistrar?: boolean }> };
  assert("total > 900K", listBody.total > 900_000, `total=${listBody.total}`);
  assert("returns 5 rows", listBody.rows?.length === 5, `got=${listBody.rows?.length}`);
  // top row should be prospect_score 100 (well-known diamond)
  assert("top row has score ≥ 95", listBody.rows[0].prospectScore >= 95, `score=${listBody.rows[0].prospectScore}`);

  // --- GET /api/entreprises filtered by dept + rge ---
  const filtered = await hit("/api/entreprises?departement=69&rge=true&has_phone=true&score_min=60&limit=10");
  assert("GET filtered returns 200", filtered.status === 200);
  const fBody = filtered.body as { total: number; rows: Array<{ siren: string; departement: string; estRge: boolean }> };
  assert("filter by dept 69 + rge returns rows", fBody.rows.length > 0, `count=${fBody.rows.length}`);
  assert("all rows are dept 69", fBody.rows.every((r) => r.departement === "69"));
  assert("all rows are RGE", fBody.rows.every((r) => r.estRge === true));

  // --- GET /api/entreprises fuzzy search ---
  const search = await hit("/api/entreprises?q=OXALIS&limit=5");
  assert("GET q=OXALIS returns 200", search.status === 200);
  const sBody = search.body as { total: number; rows: Array<{ denomination: string }> };
  assert("fuzzy search finds OXALIS", sBody.rows.some((r) => r.denomination?.includes("OXALIS")), `got ${sBody.rows.length} rows`);

  // --- GET /api/entreprises/[siren] ---
  // Pick a known diamond: POLLEN SCOP (439076563)
  const detail = await hit("/api/entreprises/439076563");
  assert("GET fiche 439076563 → 200", detail.status === 200, `status=${detail.status}`);
  const dBody = detail.body as { siren: string; denomination: string; estRge: boolean; prospectScore: number };
  assert("denomination = POLLEN SCOP", dBody.denomination === "POLLEN SCOP");
  assert("POLLEN SCOP is RGE", dBody.estRge === true);
  assert("POLLEN SCOP has prospect_score 100", dBody.prospectScore === 100);

  // --- GET /api/entreprises/[siren] invalid ---
  const invalid = await hit("/api/entreprises/abc");
  assert("GET /abc → 400", invalid.status === 400);

  const notfound = await hit("/api/entreprises/999999999");
  assert("GET /999999999 → 404", notfound.status === 404);

  // --- GET /api/entreprises/segments ---
  const segments = await hit("/api/entreprises/segments");
  assert("GET /segments → 200", segments.status === 200);
  const segBody = segments.body as { segments: Array<{ id: string; viewName: string; volume: number }> };
  assert("catalog has ≥ 20 segments", segBody.segments.length >= 20, `got=${segBody.segments.length}`);
  assert("catalog has S01", segBody.segments.some((s) => s.id === "S01"));
  assert("catalog has DIAMOND", segBody.segments.some((s) => s.id === "DIAMOND"));

  // --- GET /api/entreprises/segments/S01 ---
  const s01 = await hit("/api/entreprises/segments/S01?limit=10");
  assert("GET /segments/S01 → 200", s01.status === 200, `status=${s01.status} ${s01.ms}ms`);
  const s01Body = s01.body as { id: string; volume: number; rows: Array<{ siren: string; est_rge: boolean; web_domain_normalized: string | null }> };
  assert("S01 id matches", s01Body.id === "S01");
  assert("S01 returns 10 rows", s01Body.rows.length === 10);
  assert("S01 rows are all RGE", s01Body.rows.every((r) => r.est_rge === true));
  assert("S01 rows have no website", s01Body.rows.every((r) => r.web_domain_normalized === null));

  // --- GET /api/entreprises/segments/INVALID ---
  const invSeg = await hit("/api/entreprises/segments/XYZ999");
  assert("GET /segments/XYZ999 → 404", invSeg.status === 404);

  // Summary
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

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
