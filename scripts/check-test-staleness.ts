/**
 * check-test-staleness.ts — détecte les tests e2e/unit qui prennent la
 * poussière.
 *
 * Règle : si un fichier source (src/components/X.tsx, src/lib/X.ts) a été
 * modifié plus récemment que son test associé (e2e/X.spec.ts, src/lib/X.test.ts),
 * on émet un warning "stale test".
 *
 * But : éviter que la couverture e2e/unit devienne obsolète sans qu'on
 * s'en rende compte. Un test qui n'a pas bougé alors que le code sous-jacent
 * a été refactoré 5 fois = signal fort de régression potentielle.
 *
 * Sortie : markdown dans /tmp/test-staleness.md + exit code 0 (always, pour
 * être non-bloquant en CI).
 *
 * Mapping heuristique source → test (on cherche un spec/unit test dont le
 * nom inclut le nom du fichier source) :
 *
 *   src/components/dashboard/leads-table.tsx
 *     → e2e/*.spec.ts contenant "leads-table" ou "prospects" ou "search"
 *     → src/lib/leads-table.test.ts (n'existe pas, skip)
 *
 *   src/lib/rate-limit.ts → src/lib/rate-limit.test.ts (colocated)
 *
 * Threshold : un test est "stale" si source.mtime > test.mtime + 7 jours.
 *
 * Usage:
 *   cd dashboard
 *   npx tsx scripts/check-test-staleness.ts
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = process.cwd();
const STALE_THRESHOLD_DAYS = Number(process.env.STALENESS_DAYS || 7);
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "generated" ||
        entry.name === "test-results" ||
        entry.name === "playwright-report"
      )
        continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = walk(ROOT);

const sourceFiles = allFiles.filter(
  (f) =>
    (f.includes("/src/components/") || f.includes("/src/lib/") || f.includes("/src/app/api/")) &&
    (f.endsWith(".ts") || f.endsWith(".tsx")) &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".test.tsx") &&
    !f.endsWith(".spec.ts")
);

const testFiles = allFiles.filter(
  (f) =>
    f.endsWith(".test.ts") ||
    f.endsWith(".test.tsx") ||
    (f.includes("/e2e/") && f.endsWith(".spec.ts"))
);

function stemOf(path: string): string {
  return basename(path).replace(/\.(ts|tsx|test\.ts|test\.tsx|spec\.ts)$/, "");
}

function findRelatedTests(sourceFile: string): string[] {
  const stem = stemOf(sourceFile).toLowerCase();
  if (stem.length < 4) return []; // trop court → bruit
  return testFiles.filter((t) => {
    const tname = basename(t).toLowerCase();
    if (tname.includes(stem)) return true;
    // Special aliases — ajuste au fil de l'eau quand tu vois des mismatches
    const aliases: Record<string, string[]> = {
      "leads-table": ["search-prospects", "ui-siren-smoke", "lead-detail"],
      "prospect-page": ["search-prospects", "filters-persistence", "ui-siren-smoke"],
      "segment-page": ["segments-filter"],
      "lead-sheet": ["lead-detail-interactions", "ui-siren-smoke"],
      "client-error-boundary": ["client-error-boundary"],
      "keyboard-shortcuts-help": ["keyboard-shortcuts-help"],
      twenty: ["twenty"],
      "rate-limit": ["rate-limit"],
      "use-local-storage-persist": ["use-local-storage-persist", "filters-persistence"],
    };
    for (const [key, testStems] of Object.entries(aliases)) {
      if (stem.includes(key) && testStems.some((ts) => tname.includes(ts))) return true;
    }
    return false;
  });
}

type Finding = {
  source: string;
  sourceMtime: Date;
  tests: string[];
  staleness: "no-test" | "stale" | "ok";
  latestTestMtime: Date | null;
  ageDeltaMs: number;
};

const findings: Finding[] = [];
for (const src of sourceFiles) {
  const srcStat = statSync(src);
  const related = findRelatedTests(src);
  if (related.length === 0) {
    findings.push({
      source: src,
      sourceMtime: srcStat.mtime,
      tests: [],
      staleness: "no-test",
      latestTestMtime: null,
      ageDeltaMs: 0,
    });
    continue;
  }
  const latest = related
    .map((t) => ({ t, m: statSync(t).mtime }))
    .sort((a, b) => b.m.getTime() - a.m.getTime())[0];
  const delta = srcStat.mtime.getTime() - latest.m.getTime();
  findings.push({
    source: src,
    sourceMtime: srcStat.mtime,
    tests: related,
    staleness: delta > STALE_THRESHOLD_MS ? "stale" : "ok",
    latestTestMtime: latest.m,
    ageDeltaMs: delta,
  });
}

// Report
const stale = findings.filter((f) => f.staleness === "stale");
const noTest = findings.filter((f) => f.staleness === "no-test");
const ok = findings.filter((f) => f.staleness === "ok");

const lines: string[] = [];
lines.push("# Test staleness report");
lines.push("");
lines.push(`- scanned: **${sourceFiles.length}** source files`);
lines.push(`- tested: **${ok.length}** up-to-date, **${stale.length}** stale, **${noTest.length}** without any test`);
lines.push(`- stale threshold: ${STALE_THRESHOLD_DAYS} days`);
lines.push(`- timestamp: ${new Date().toISOString()}`);
lines.push("");

if (stale.length > 0) {
  lines.push("## ⚠️ Stale tests (source modified more recently than test)");
  lines.push("");
  lines.push("| Source | Latest test | Age delta | Test files |");
  lines.push("|---|---|---|---|");
  for (const f of stale.slice(0, 50)) {
    const days = Math.round(f.ageDeltaMs / 86_400_000);
    const rel = relative(ROOT, f.source);
    const testsRel = f.tests.map((t) => `\`${relative(ROOT, t)}\``).join(", ");
    lines.push(
      `| \`${rel}\` | ${f.latestTestMtime?.toISOString().slice(0, 10)} | +${days}d | ${testsRel} |`
    );
  }
  lines.push("");
}

if (noTest.length > 0) {
  lines.push(`## 🔍 Source files without related tests (top 30 sur ${noTest.length})`);
  lines.push("");
  lines.push(
    "Ces fichiers n'ont AUCUN test unit ou e2e détecté par le matcher heuristique. Possiblement OK pour des fichiers pur-type ou pur-config, mais à vérifier."
  );
  lines.push("");
  for (const f of noTest.slice(0, 30)) {
    lines.push(`- \`${relative(ROOT, f.source)}\``);
  }
  lines.push("");
}

lines.push("## ✅ Up-to-date");
lines.push("");
lines.push(`${ok.length} fichiers ont un test récent (< ${STALE_THRESHOLD_DAYS}j).`);
lines.push("");
lines.push(
  "---\nGénéré par `scripts/check-test-staleness.ts`. Ne fail jamais le CI. Regarde le rapport comme une check-list à nettoyer périodiquement."
);

const report = lines.join("\n");
writeFileSync("/tmp/test-staleness.md", report);
console.log(report);

console.log(
  `\nSummary: ${ok.length} ok / ${stale.length} stale / ${noTest.length} no-test (total ${sourceFiles.length} sources)`
);
process.exit(0);
