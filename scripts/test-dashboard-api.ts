/**
 * Smoke API authentifié — routes métier du dashboard post-SIREN refactor.
 *
 * Hit 10+ endpoints avec une session Supabase réelle (magic link) pour
 * vérifier que les routes répondent 200 avec un payload cohérent après le
 * passage results/domain → entreprises/siren.
 *
 * Flow:
 *   1. magic link admin via Supabase admin API pour robert@veridian.site
 *   2. verifyOtp → session (access_token)
 *   3. build cookie @supabase/ssr format (base64-<json>)
 *   4. fetch chaque route avec ce cookie
 *   5. assert status + forme du body
 *
 * Usage (staging):
 *   APP_URL=https://saas-prospection.staging.veridian.site \
 *   SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/test-dashboard-api.ts
 *
 * Le script exit 1 si une assertion échoue.
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const APP_URL = process.env.APP_URL || "https://saas-prospection.staging.veridian.site";
const TEST_EMAIL = process.env.TEST_EMAIL || "robert@veridian.site";

type Assertion = { name: string; ok: boolean; details?: string };
const assertions: Assertion[] = [];
const failures: Array<{ name: string; body: unknown; status: number }> = [];

function assert(name: string, cond: boolean, details?: string) {
  assertions.push({ name, ok: cond, details });
  console.log(`${cond ? "✓" : "✗"} ${name}${details ? ` — ${details}` : ""}`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_ANON_KEY required"
    );
  }

  // 1) Magic link via admin API
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? "no hashed_token"}`);
  }

  // 2) verifyOtp → session
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
  console.log(`✓ session for ${TEST_EMAIL} (${sessionData.user?.id})`);

  // 3) Cookie @supabase/ssr
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
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
    try {
      payload = await res.json();
    } catch {
      /* no body */
    }
    return { status: res.status, body: payload };
  }

  function recordFailure(name: string, status: number, body: unknown) {
    failures.push({ name, status, body });
  }

  // --- 4) Routes métier ---

  // /api/stats
  {
    const r = await hit("GET", "/api/stats");
    const ok = r.status === 200 && typeof r.body === "object" && r.body !== null;
    assert("GET /api/stats → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/stats", r.status, r.body);
    else {
      const s = r.body as { total?: number; with_phone?: number };
      assert("/api/stats has total > 0", (s.total ?? 0) > 0, `total=${s.total}`);
      assert("/api/stats has with_phone >= 0", (s.with_phone ?? -1) >= 0, `with_phone=${s.with_phone}`);
    }
  }

  // /api/stats/by-department
  {
    const r = await hit("GET", "/api/stats/by-department");
    const ok = r.status === 200;
    assert("GET /api/stats/by-department → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/stats/by-department", r.status, r.body);
  }

  // /api/sectors
  {
    const r = await hit("GET", "/api/sectors");
    const ok = r.status === 200;
    assert("GET /api/sectors → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/sectors", r.status, r.body);
  }

  // /api/prospects?preset=tous
  {
    const r = await hit("GET", "/api/prospects?preset=tous&page=1&pageSize=5");
    const ok = r.status === 200;
    assert("GET /api/prospects?preset=tous → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/prospects", r.status, r.body);
    else {
      const b = r.body as { data?: Array<{ domain?: string; web_domain?: string | null }> };
      assert("/api/prospects has data array", Array.isArray(b.data), `data=${typeof b.data}`);
      const len = b.data?.length ?? 0;
      console.log(`  ℹ /api/prospects rows=${len} (0 OK si tenant fresh sans workspace)`);
      // web_domain peut être null mais la clé doit exister (shape check)
      if (len > 0) {
        const first = b.data![0];
        assert(
          "/api/prospects rows have domain (SIREN) field",
          typeof first.domain === "string" || first.domain === null,
          `domain=${first.domain}`
        );
      }
    }
  }

  // /api/prospects?preset=top_prospects
  {
    const r = await hit("GET", "/api/prospects?preset=top_prospects&page=1&pageSize=5");
    const ok = r.status === 200;
    assert("GET /api/prospects?preset=top_prospects → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/prospects top_prospects", r.status, r.body);
  }

  // /api/pipeline
  {
    const r = await hit("GET", "/api/pipeline");
    const ok = r.status === 200;
    assert("GET /api/pipeline → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/pipeline", r.status, r.body);
  }

  // /api/segments
  {
    const r = await hit("GET", "/api/segments");
    const ok = r.status === 200;
    assert("GET /api/segments → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/segments", r.status, r.body);
  }

  // /api/followups
  {
    const r = await hit("GET", "/api/followups");
    const ok = r.status === 200;
    assert("GET /api/followups → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/followups", r.status, r.body);
  }

  // /api/claude/stats
  {
    const r = await hit("GET", "/api/claude/stats");
    const ok = r.status === 200;
    assert("GET /api/claude/stats → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/claude/stats", r.status, r.body);
  }

  // /api/stats/today
  {
    const r = await hit("GET", "/api/stats/today");
    const ok = r.status === 200;
    assert("GET /api/stats/today → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/stats/today", r.status, r.body);
  }

  // /api/settings
  {
    const r = await hit("GET", "/api/settings");
    const ok = r.status === 200;
    assert("GET /api/settings → 200", ok, `status=${r.status}`);
    if (!ok) recordFailure("/api/settings", r.status, r.body);
  }

  // /api/health (public, mais on vérifie que ça existe)
  {
    const r = await hit("GET", "/api/health");
    const ok = r.status === 200;
    assert("GET /api/health → 200", ok, `status=${r.status}`);
  }

  // /api/leads/:siren — POLLEN SCOP (diamond canonique)
  {
    const r = await hit("GET", "/api/leads/439076563");
    const ok = r.status === 200 || r.status === 404;
    assert(
      "GET /api/leads/439076563 → 200 ou 404 (ne crash pas)",
      ok,
      `status=${r.status}`
    );
    if (r.status === 200) {
      const b = r.body as { domain?: string; denomination?: string };
      assert(
        "/api/leads/439076563 has SIREN as domain",
        b.domain === "439076563",
        `domain=${b.domain}`
      );
    }
    if (!ok) recordFailure("/api/leads/439076563", r.status, r.body);
  }

  // --- 5) Rapport ---
  const passed = assertions.filter((a) => a.ok).length;
  const failed = assertions.length - passed;
  console.log(`\n${passed}/${assertions.length} assertions passed`);

  if (failures.length > 0) {
    const lines: string[] = ["# API Smoke Failures — dashboard post-SIREN refactor", ""];
    lines.push(`Généré par scripts/test-dashboard-api.ts contre ${APP_URL}`);
    lines.push("");
    for (const f of failures) {
      lines.push(`## ${f.name}`);
      lines.push(`- status: ${f.status}`);
      lines.push("- body:");
      lines.push("```json");
      lines.push(JSON.stringify(f.body, null, 2));
      lines.push("```");
      lines.push("");
    }
    writeFileSync("/tmp/api-smoke-failures.md", lines.join("\n"));
    console.log(`→ failures written to /tmp/api-smoke-failures.md`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
