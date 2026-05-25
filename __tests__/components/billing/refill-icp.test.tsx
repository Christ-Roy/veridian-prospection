/**
 * Tests source-level pour les 8 composants refill ICP.
 *
 * Pattern source-level (cf refill-modal.test.tsx) : les composants Radix
 * (Slider, Select, etc.) sont coûteux à render en JSDOM. On audit le source
 * pour garantir les invariants critiques :
 *  - imports depuis le module central `@/lib/refill-icp/filters` (pas de
 *    duplication des catalogues NAF/dép)
 *  - utilisation du composant Slider partagé
 *  - controlled props (value + onChange) — pas de state interne dérivé qui
 *    ferait diverger le state parent
 *  - LiveCountPreview : debounce 300ms + AbortController (anti-spam)
 *  - OrderSummaryCard : fetch /api/refill/start + redirect window.location
 *  - Gating qualifiers business (lock icon visible)
 */
import { describe, expect, test, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

describe("SectorMultiSelect.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/SectorMultiSelect.tsx");
  });

  test("imports SECTOR_PRESETS depuis @/lib/refill-icp/filters", () => {
    expect(src).toMatch(
      /from\s+"@\/lib\/refill-icp\/filters"/,
    );
    expect(src).toContain("SECTOR_PRESETS");
  });

  test("controlled : props value + onChange (pas de state interne)", () => {
    expect(src).toMatch(/value:\s*string\[\]/);
    expect(src).toMatch(/onChange:\s*\(next:\s*string\[\]\)\s*=>\s*void/);
  });

  test("validation NAF code via regex (pas d'injection libre)", () => {
    expect(src).toMatch(/isLikelyNafCode|\/\^\[0-9\]/);
  });
});

describe("GeoMultiSelect.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/GeoMultiSelect.tsx");
  });

  test("imports FR_DEPARTMENTS + REGION_PRESETS depuis lib", () => {
    expect(src).toMatch(/from\s+"@\/lib\/refill-icp\/filters"/);
    expect(src).toContain("FR_DEPARTMENTS");
    expect(src).toContain("REGION_PRESETS");
  });

  test("validation département via FR_DEPARTMENTS.includes (whitelist)", () => {
    expect(src).toContain("FR_DEPARTMENTS.includes");
  });

  test("controlled (value + onChange)", () => {
    expect(src).toMatch(/value:\s*string\[\]/);
    expect(src).toMatch(/onChange:\s*\(next:\s*string\[\]\)\s*=>\s*void/);
  });
});

describe("EmployeeRangeSlider.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/EmployeeRangeSlider.tsx");
  });

  test("uses shadcn Slider component", () => {
    expect(src).toContain('from "@/components/ui/slider"');
    expect(src).toContain("<Slider");
  });

  test("range [min, max] tuple", () => {
    expect(src).toMatch(/\[number,\s*number\]/);
  });

  test("nettoie le filter à undefined sur reset complet (no filter active)", () => {
    // Quand min===HARD_MIN && max===HARD_MAX → onChange(undefined)
    expect(src).toMatch(/onChange\(undefined\)/);
  });
});

describe("RevenueRangeSlider.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/RevenueRangeSlider.tsx");
  });

  test("uses Slider shadcn", () => {
    expect(src).toContain("<Slider");
  });

  test("steps array defines log-like buckets (0..100M€)", () => {
    expect(src).toContain("STEPS");
    expect(src).toContain("100_000_000");
  });

  test("formatEur affiche €", () => {
    expect(src).toContain("€");
  });
});

describe("AgeRangeSelect.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/AgeRangeSelect.tsx");
  });

  test("4 buckets pré-définis + 'any'", () => {
    // < 2 ans, 2-5, 5-10, > 10 + "Tous"
    expect(src).toMatch(/young|< 2 ans/);
    expect(src).toMatch(/established|5 à 10/);
    expect(src).toMatch(/mature|> 10/);
  });

  test("pick 'any' → onChange(undefined)", () => {
    expect(src).toMatch(/onChange\(undefined\)/);
  });
});

describe("QualifierTagsSelect.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/QualifierTagsSelect.tsx");
  });

  test("imports QUALIFIER_KEYS + type from filters lib", () => {
    expect(src).toMatch(/from\s+"@\/lib\/refill-icp\/filters"/);
    expect(src).toContain("QUALIFIER_KEYS");
    expect(src).toContain("QualifierKey");
  });

  test("gated prop disables interaction + shows lock icon", () => {
    expect(src).toMatch(/gated/);
    expect(src).toMatch(/Lock/);
  });

  test("disabled (effDisabled) state for buttons", () => {
    expect(src).toContain("effDisabled");
  });
});

describe("LiveCountPreview.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/LiveCountPreview.tsx");
  });

  test("debounce 300ms (anti-spam DB)", () => {
    expect(src).toContain("DEBOUNCE_MS");
    expect(src).toMatch(/300/);
  });

  test("AbortController pour annuler les requêtes obsolètes", () => {
    expect(src).toContain("AbortController");
    expect(src).toContain("abort");
  });

  test("fetch /api/leads/estimate-count avec POST + JSON", () => {
    expect(src).toMatch(/fetch\(\s*"\/api\/leads\/estimate-count"/);
    expect(src).toMatch(/method:\s*"POST"/);
    expect(src).toMatch(/"Content-Type":\s*"application\/json"/);
  });

  test("aria-live='polite' pour SR users", () => {
    expect(src).toContain('aria-live="polite"');
  });

  test("classifyPool retourne 3 niveaux tonaux (green/amber/red)", () => {
    expect(src).toMatch(/"green"/);
    expect(src).toMatch(/"amber"/);
    expect(src).toMatch(/"red"/);
  });
});

describe("OrderSummaryCard.tsx", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/OrderSummaryCard.tsx");
  });

  test("calculateRefillCostCents importé depuis @/lib/billing/plans (pas de duplication calcul)", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*calculateRefillCostCents[^}]*\}\s*from\s*"@\/lib\/billing\/plans"/,
    );
  });

  test("fetch /api/refill/start avec POST + JSON body inclut filters", () => {
    expect(src).toMatch(/fetch\(\s*"\/api\/refill\/start"/);
    expect(src).toMatch(/method:\s*"POST"/);
    expect(src).toContain("filters");
  });

  test("redirige window.location.href sur succès Stripe", () => {
    expect(src).toMatch(/window\.location\.href\s*=\s*data\.url/);
  });

  test("disabled si quantity > maxOrderable (anti-tampering UI)", () => {
    expect(src).toMatch(/quantity\s*>\s*effectiveMax/);
  });

  test("toast.error sur échec (sonner) — pas de crash UI", () => {
    expect(src).toMatch(/toast\.error/);
  });
});

describe("RefillIcpClient.tsx (container)", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/components/billing/refill-icp/RefillIcpClient.tsx");
  });

  test("monte les 8 composants ICP + preview + summary", () => {
    expect(src).toContain("<SectorMultiSelect");
    expect(src).toContain("<GeoMultiSelect");
    expect(src).toContain("<EmployeeRangeSlider");
    expect(src).toContain("<RevenueRangeSlider");
    expect(src).toContain("<AgeRangeSelect");
    expect(src).toContain("<QualifierTagsSelect");
    expect(src).toContain("<LiveCountPreview");
    expect(src).toContain("<OrderSummaryCard");
  });

  test("qualifiers gated si tier ≠ business", () => {
    expect(src).toMatch(/businessGated/);
    expect(src).toMatch(/initialTier\s*!==\s*"business"/);
  });

  test("state filters initialisé via RefillIcpFiltersSchema parse (default country=FR)", () => {
    expect(src).toContain("RefillIcpFiltersSchema");
    expect(src).toMatch(/safeParse\(\{\}\)/);
  });

  test("patch helper supprime la clé si val undefined ou array vide", () => {
    expect(src).toMatch(/delete next\[key\]/);
  });
});

describe("Page /leads/buy", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/app/leads/buy/page.tsx");
  });

  test("server component avec auth gate", () => {
    expect(src).toContain("await auth()");
    expect(src).toMatch(/redirect\("\/login\?next=\/leads\/buy"\)/);
  });

  test("résolution tenant : direct ownership puis fallback membership", () => {
    expect(src).toContain("tenant.findFirst");
    expect(src).toContain("workspaceMember.findFirst");
  });

  test("mappe tenant.plan vers refill tier via mapTenantPlanToRefillTier", () => {
    expect(src).toContain("mapTenantPlanToRefillTier");
  });

  test("rend <RefillIcpClient> avec initialTier + planLabel", () => {
    expect(src).toContain("<RefillIcpClient");
    expect(src).toContain("initialTier=");
    expect(src).toContain("planLabel=");
  });
});

describe("API route /api/refill/start", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/app/api/refill/start/route.ts");
  });

  test("requireUser session check (pas d'achat anonyme)", () => {
    expect(src).toContain("requireUser()");
  });

  test("rate-limit isRateLimited (60/min/user)", () => {
    expect(src).toContain("isRateLimited");
    expect(src).toMatch(/60[^0-9]/);
  });

  test("anti-tampering : re-compte server-side via $queryRawUnsafe", () => {
    expect(src).toContain("$queryRawUnsafe");
    expect(src).toMatch(/quantity\s*>\s*available/);
  });

  test("HMAC vers Hub via createRefillCheckoutFromApp (jamais Stripe direct)", () => {
    expect(src).toContain("createRefillCheckoutFromApp");
    expect(src).not.toContain("stripe.checkout");
  });

  test("502 sur hub_timeout / hub_server_error, 500 sur hub_misconfigured", () => {
    // La route encode 502 via une variable: `const status = ... ? 500 : 502`
    expect(src).toMatch(/\?\s*500\s*:\s*502|502\s*:\s*500/);
    expect(src).toMatch(/hub_misconfigured/);
  });
});

describe("API route /api/leads/estimate-count", () => {
  let src = "";
  beforeAll(() => {
    src = readSrc("src/app/api/leads/estimate-count/route.ts");
  });

  test("requireUser session check", () => {
    expect(src).toContain("requireUser()");
  });

  test("rate-limit (30/min/user — anti-DoS DB)", () => {
    expect(src).toContain("isRateLimited");
    expect(src).toMatch(/30[^0-9]/);
  });

  test("SQL paramétré via $queryRawUnsafe + spread params (anti-injection)", () => {
    expect(src).toContain("$queryRawUnsafe");
    expect(src).toContain("...params");
  });

  test("validation Zod via RefillIcpFiltersSchema", () => {
    expect(src).toContain("RefillIcpFiltersSchema");
    expect(src).toContain(".safeParse");
  });

  test("503 si DB error (rollback propre, pas de 500 brut)", () => {
    expect(src).toMatch(/status:\s*503/);
    expect(src).toMatch(/db_error/);
  });
});

describe("Migration 0026_add_lead_orders", () => {
  let sql = "";
  beforeAll(() => {
    sql = readSrc("prisma/migrations/0026_add_lead_orders/migration.sql");
  });

  test("CREATE TABLE lead_orders", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "lead_orders"');
  });

  test("idempotency_key UNIQUE (anti-double-credit)", () => {
    expect(sql).toMatch(/idempotency_key.*UNIQUE|UNIQUE INDEX.*idempotency_key/i);
  });

  test("CHECK source ∈ enum", () => {
    expect(sql).toMatch(/CHECK\s*\(\s*"source"\s+IN/);
  });

  test("CHECK quantity > 0", () => {
    expect(sql).toMatch(/CHECK\s*\(\s*"quantity"\s*>\s*0\s*\)/);
  });

  test("index workspace_id + created_at DESC (listing UI)", () => {
    expect(sql).toMatch(/idx_lead_orders_workspace_created/);
  });
});
