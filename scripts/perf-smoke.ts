/**
 * perf-smoke.ts — ping 10 routes API principales N fois, rapporte p50/p95/p99.
 *
 * Objet : détecter les régressions de performance (boucles infinies, N+1
 * queries, fetch sans pagination, caches mal configurés) AVANT qu'elles
 * arrivent en prod. Cf. docs/CI-STRATEGY.md couche 3.
 *
 * Chaque route est appelée avec une session Supabase réelle (magic link
 * admin → verifyOtp → cookie ssr) pour tester le chemin complet incluant
 * middleware auth + getUserContext + DB query.
 *
 * Seuils par défaut :
 *   p95_threshold_ms = 3000  # route metier reasonable
 *   p99_threshold_ms = 6000
 * Override via env : PERF_P95_MS, PERF_P99_MS
 *
 * Sortie : JSON dans /tmp/perf-report.json + markdown dans /tmp/perf-report.md
 * pour artifact CI.
 *
 * Usage:
 *   APP_URL=https://saas-prospection.staging.veridian.site \
 *   SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_URL=https://saas-api.staging.veridian.site \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/perf-smoke.ts
 *
 * Exit code:
 *   0 si p95 < P95_THRESHOLD pour toutes les routes
 *   1 si une route dépasse le seuil (utilisé en CI comme warning non-bloquant
 *     via `continue-on-error: true` côté workflow)
 *   2 si erreur fatale (pas de session, pas de creds, etc.)
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const APP_URL = process.env.APP_URL || "https://saas-prospection.staging.veridian.site";
const TEST_EMAIL = process.env.TEST_EMAIL || "robert@veridian.site";
const ITERATIONS = Number(process.env.PERF_ITERATIONS || 5);
const P95_THRESHOLD_MS = Number(process.env.PERF_P95_MS || 3000);
const P99_THRESHOLD_MS = Number(process.env.PERF_P99_MS || 6000);

type RouteResult = {
  route: string;
  samples: number[];
  status_codes: number[];
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  mean: number;
  ok: boolean;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey || !anonKey) {
    console.error("Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ANON_KEY");
    process.exit(2);
  }

  // Generate session via magic link → verifyOtp (same pattern as
  // test-dashboard-api.ts)
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error("generateLink failed:", linkErr?.message);
    process.exit(2);
  }
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: sessionData, error: otpErr } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (otpErr || !sessionData?.session) {
    console.error("verifyOtp failed:", otpErr?.message);
    process.exit(2);
  }
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

  const ROUTES: Array<{ path: string; method?: string }> = [
    { path: "/api/health" },
    { path: "/api/status" },
    { path: "/api/stats" },
    { path: "/api/stats/today" },
    { path: "/api/stats/by-department" },
    { path: "/api/sectors" },
    { path: "/api/segments" },
    { path: "/api/prospects?preset=tous&page=1&pageSize=10" },
    { path: "/api/pipeline" },
    { path: "/api/followups" },
    { path: "/api/claude/stats" },
    { path: "/api/settings" },
  ];

  console.log(`\nperf-smoke: ${ITERATIONS} iterations per route on ${APP_URL}`);
  console.log(`thresholds: p95 < ${P95_THRESHOLD_MS}ms, p99 < ${P99_THRESHOLD_MS}ms\n`);

  const results: RouteResult[] = [];
  for (const r of ROUTES) {
    const samples: number[] = [];
    const statuses: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = Date.now();
      try {
        const res = await fetch(`${APP_URL}${r.path}`, {
          method: r.method || "GET",
          headers: { Cookie: cookieHeader },
        });
        const elapsed = Date.now() - start;
        samples.push(elapsed);
        statuses.push(res.status);
      } catch (e) {
        const elapsed = Date.now() - start;
        samples.push(elapsed);
        statuses.push(0);
        console.warn(`  [${r.path}] iter ${i + 1} fetch failed: ${e}`);
      }
    }
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);
    const max = Math.max(...samples);
    const min = Math.min(...samples);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const ok = p95 <= P95_THRESHOLD_MS && p99 <= P99_THRESHOLD_MS;
    const result: RouteResult = {
      route: r.path,
      samples,
      status_codes: statuses,
      p50,
      p95,
      p99,
      max,
      min,
      mean: Math.round(mean),
      ok,
    };
    results.push(result);
    const statusSymbol = ok ? "✓" : "✗";
    console.log(
      `${statusSymbol} ${r.path.padEnd(55)} p50=${p50}ms p95=${p95}ms p99=${p99}ms (status=${statuses.join(",")})`
    );
  }

  // Aggregate
  const allOk = results.every((r) => r.ok);
  const report = {
    app_url: APP_URL,
    iterations: ITERATIONS,
    thresholds_ms: { p95: P95_THRESHOLD_MS, p99: P99_THRESHOLD_MS },
    timestamp: new Date().toISOString(),
    all_routes_ok: allOk,
    results,
  };

  writeFileSync("/tmp/perf-report.json", JSON.stringify(report, null, 2));

  // Markdown summary
  const mdLines: string[] = [];
  mdLines.push("# Perf smoke report");
  mdLines.push("");
  mdLines.push(`- app: \`${APP_URL}\``);
  mdLines.push(`- iterations per route: ${ITERATIONS}`);
  mdLines.push(`- p95 threshold: ${P95_THRESHOLD_MS}ms`);
  mdLines.push(`- p99 threshold: ${P99_THRESHOLD_MS}ms`);
  mdLines.push(`- overall: ${allOk ? "✅ OK" : "⚠️ regressions"}`);
  mdLines.push("");
  mdLines.push("| Route | p50 | p95 | p99 | max | status |");
  mdLines.push("|---|---|---|---|---|---|");
  for (const r of results) {
    const statusStr = r.ok ? "✅" : "⚠️";
    mdLines.push(
      `| \`${r.route}\` | ${r.p50}ms | ${r.p95}ms | ${r.p99}ms | ${r.max}ms | ${statusStr} |`
    );
  }
  writeFileSync("/tmp/perf-report.md", mdLines.join("\n"));

  console.log(`\n${allOk ? "✅" : "⚠️"} Report written to /tmp/perf-report.{json,md}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
