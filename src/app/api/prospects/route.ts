import { NextRequest, NextResponse } from "next/server";
import { getProspects, getDomainCounts, getPresetCounts, getAllSettings } from "@/lib/queries";
import { cached } from "@/lib/cache";
import type { ProspectPreset } from "@/lib/domains";
import type { ProspectFilters } from "@/lib/queries/prospects";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";
import { isRateLimited } from "@/lib/rate-limit";

// Parse filter params from search params
function parseFilters(sp: URLSearchParams): ProspectFilters {
  const filters: ProspectFilters = {};

  // Search
  const q = sp.get("q");
  if (q && q.trim()) filters.search = q.trim();

  // Secteur / domaine filter
  const secteurs = sp.get("secteurs");
  if (secteurs) filters.secteurs = secteurs.split(",").map(s => s.trim()).filter(Boolean);
  const domaines = sp.get("domaines");
  if (domaines) filters.domaines = domaines.split(",").map(d => d.trim()).filter(Boolean);

  // Geo filter — accept both "dept" (canonical, used by UI) and "departement" (natural alias)
  const dept = sp.get("dept") || sp.get("departement");
  if (dept) {
    filters.depts = dept.split(",").map(d => d.trim()).filter(Boolean);
  }

  // Size filter — effectifs codes
  const eff = sp.get("effectifsCodes");
  if (eff) {
    filters.effectifsCodes = eff.split(",").map(e => e.trim()).filter(Boolean);
  }

  // Mobile only
  if (sp.get("mobileOnly") === "1") {
    filters.mobileOnly = true;
  }

  // CA ranges (multi-select tranches)
  const caRangesStr = sp.get("caRanges");
  if (caRangesStr) {
    const CA_TRANCHES = [
      { min: null, max: 100000 },
      { min: 100000, max: 500000 },
      { min: 500000, max: 2000000 },
      { min: 2000000, max: 5000000 },
      { min: 5000000, max: 10000000 },
      { min: 10000000, max: null },
    ];
    filters.caRanges = caRangesStr.split(",").map(Number).filter(i => i >= 0 && i < CA_TRANCHES.length).map(i => CA_TRANCHES[i]);
  } else {
    // Fallback: single CA range
    const caMin = sp.get("caMin");
    if (caMin) filters.caMin = parseInt(caMin) || null;
    const caMax = sp.get("caMax");
    if (caMax) filters.caMax = parseInt(caMax) || null;
  }

  // Size operator
  const op = sp.get("sizeOperator");
  if (op === "and" || op === "or") filters.sizeOperator = op;

  // Quality filter
  if (sp.get("hideDuplicateSiren") === "1") {
    filters.hideDuplicateSiren = true;
  }
  if (sp.get("unseenOnly") === "1") {
    filters.unseenOnly = true;
  }
  const minTech = sp.get("minTechScore");
  if (minTech) filters.minTechScore = parseInt(minTech) || 0;

  // Data requirements
  if (sp.get("requirePhone") === "1") filters.requirePhone = true;
  if (sp.get("requireEmail") === "1") filters.requireEmail = true;
  if (sp.get("requireDirigeant") === "1") filters.requireDirigeant = true;
  if (sp.get("requireEnriched") === "1") filters.requireEnriched = true;

  // Exclusions
  if (sp.get("excludeAssociations") === "1") filters.excludeAssociations = true;
  if (sp.get("excludePhoneShared") === "1") filters.excludePhoneShared = true;
  if (sp.get("excludeHttpDead") === "1") filters.excludeHttpDead = true;

  // Website presence toggle
  const hasWebsite = sp.get("hasWebsite");
  if (hasWebsite === "1") filters.hasWebsite = "with";
  else if (hasWebsite === "0") filters.hasWebsite = "without";

  // Certifications
  if (sp.get("requireRge") === "1") filters.requireRge = true;
  if (sp.get("requireQualiopi") === "1") filters.requireQualiopi = true;
  if (sp.get("requireBio") === "1") filters.requireBio = true;
  if (sp.get("requireEpv") === "1") filters.requireEpv = true;
  if (sp.get("requireBni") === "1") filters.requireBni = true;
  const qualiopiSpec = sp.get("qualiopiSpecialite");
  if (qualiopiSpec && qualiopiSpec.trim()) filters.qualiopiSpecialite = qualiopiSpec.trim();
  if (sp.get("nonIdentifieAvecTel") === "1") filters.nonIdentifieAvecTel = true;

  // Dirigeant age ranges (CSV: "0-34,35-44,>=65")
  const ageDirigeant = sp.get("ageDirigeant");
  if (ageDirigeant) {
    const ranges = ageDirigeant.split(",").map(s => s.trim()).filter(Boolean);
    if (ranges.length > 0) filters.ageDirigeantRanges = ranges;
  }

  return filters;
}

function hasFilters(filters: ProspectFilters): boolean {
  return !!(
    filters.search ||
    filters.secteurs?.length ||
    filters.domaines?.length ||
    filters.caRanges?.length ||
    filters.depts?.length ||
    filters.effectifsCodes?.length ||
    filters.mobileOnly ||
    filters.caMin != null ||
    filters.caMax != null ||
    filters.hideDuplicateSiren ||
    filters.unseenOnly ||
    (filters.minTechScore && filters.minTechScore > 0) ||
    filters.requirePhone ||
    filters.requireEmail ||
    filters.requireDirigeant ||
    filters.requireEnriched ||
    filters.excludeAssociations ||
    filters.excludePhoneShared ||
    filters.excludeHttpDead ||
    filters.hasWebsite ||
    filters.requireRge ||
    filters.requireQualiopi ||
    filters.requireBio ||
    filters.requireEpv ||
    filters.requireBni ||
    filters.qualiopiSpecialite ||
    filters.nonIdentifieAvecTel ||
    (filters.ageDirigeantRanges && filters.ageDirigeantRanges.length > 0)
  );
}

// Anti-scraping: max 20 page loads per minute per user
const PAGES_RATE_LIMIT = 20;
const PAGES_WINDOW_MS = 60_000;

// GET /api/prospects?domain=btp&preset=top_prospects&page=1&pageSize=50&sort=tech_score&sortDir=desc&dept=69,42
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Rate limiting: 20 pages/min per user
  if (isRateLimited(`pages:${auth.user.id}`, PAGES_RATE_LIMIT, PAGES_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Trop de requetes. Reessayez dans quelques instants." },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }

  const tenantId = await getTenantId(auth.user.id);
  const { userFilter } = await getWorkspaceScope();
  const sp = request.nextUrl.searchParams;
  const action = sp.get("action");
  const filters = parseFilters(sp);

  // Visibility scope: if the user's workspace membership is 'own', restrict
  // prospect rows to only those with an outreach record owned by them.
  if (userFilter) filters.userFilter = userFilter;

  // Enforce lead quota for freemium users
  const prospectLimit = await getTenantProspectLimit(auth.user.id);
  if (prospectLimit <= 300) {
    // Freemium plan — enforce onboarding departments + sector + 300 lead pool
    const settings = await getAllSettings(tenantId);
    const onboardingDepts = settings["settings.onboarding_departments"];
    const quotaSectors = settings["settings.quota_sectors"];

    const depts = onboardingDepts ? onboardingDepts.split(",").map((d: string) => d.trim()).filter(Boolean) : [];
    const sectors = quotaSectors ? quotaSectors.split(",").map((s: string) => s.trim()).filter(Boolean) : [];

    if (depts.length > 0) filters.depts = depts;

    // Build proportional 300-lead pool via SQL window function
    const { buildFreemiumLeadPoolSQL } = await import("@/lib/queries/lead-quota");
    const poolSQL = buildFreemiumLeadPoolSQL(depts, sectors, 300);
    try {
      const { prisma } = await import("@/lib/prisma");
      const poolRows = await prisma.$queryRawUnsafe<{ siren: string }[]>(poolSQL);
      if (poolRows.length > 0) {
        filters.quotaPool = poolRows.map(r => r.siren);
      }
    } catch (e) {
      console.warn("[prospects] Freemium pool query failed, falling back to dept filter only:", e);
    }
  }

  const hasF = hasFilters(filters);

  // Parse preset(s) — comma-separated, e.g. "top_prospects,btp_artisans"
  const presetParam = sp.get("preset") ?? "top_prospects";
  const presets = presetParam.split(",").filter(Boolean) as ProspectPreset[];
  const presetsCacheKey = [...presets].sort().join(",");
  const tid = tenantId ?? "null";

  // Action: get domain counts for sidebar
  if (action === "domain-counts") {
    // Only cache if no filters (filtered counts change often)
    if (!hasF) {
      const counts = await cached(`domain-counts-${presetsCacheKey}-${tid}`, 5 * 60 * 1000, () => getDomainCounts(presets, undefined, tenantId));
      return NextResponse.json(counts, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }
    const counts = await getDomainCounts(presets, filters, tenantId);
    return NextResponse.json(counts, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  // Action: get preset counts for preset tabs
  if (action === "preset-counts") {
    const domainId = sp.get("domain") ?? "all";
    if (!hasF) {
      const counts = await cached(`preset-counts-${domainId}-${tid}`, 5 * 60 * 1000, () => getPresetCounts(domainId, undefined, tenantId));
      return NextResponse.json(counts, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }
    const counts = await getPresetCounts(domainId, filters, tenantId);
    return NextResponse.json(counts, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  }

  // Default: get prospect list
  const domainId = sp.get("domain") ?? "all";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") ?? "50")));
  const sort = sp.get("sort") ?? undefined;
  const sortDir = sp.get("sortDir") === "asc" ? "asc" as const : "desc" as const;

  const result = await getProspects({ domainId, presets, page, pageSize, sort, sortDir, filters }, tenantId);

  // Obfuscate sensitive fields only for freemium users with expired trial
  // Paid plans (pro, enterprise) never see obfuscated data
  const isPaidPlan = prospectLimit > 300;
  const isTrialExpired = isPaidPlan ? false : await checkTrialExpired(auth.user.id);
  const payload = isTrialExpired ? truncateSensitiveFields(result) : result;

  // BigInt from Prisma/Postgres can't be serialized — convert to Number
  return NextResponse.json(JSON.parse(JSON.stringify(payload, (_, v) => typeof v === "bigint" ? Number(v) : v)), {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}

import { checkTrialExpired } from "@/lib/trial";

const SENSITIVE_FIELDS = ["domain", "nom_entreprise", "email", "dirigeant_email", "phone", "dirigeant", "qualite_dirigeant", "ville", "address"];

function truncateSensitiveFields(result: { data: Record<string, unknown>[]; [k: string]: unknown }) {
  return {
    ...result,
    data: result.data.map((row: Record<string, unknown>) => {
      const truncated = { ...row };
      for (const field of SENSITIVE_FIELDS) {
        const val = truncated[field];
        if (typeof val === "string" && val.length > 0) {
          // Don't break JSON arrays — replace with empty array
          if (val.startsWith("[")) {
            truncated[field] = "[]";
          } else {
            const cutoff = Math.max(1, Math.floor(val.length * 0.33));
            truncated[field] = val.slice(0, cutoff) + "•".repeat(val.length - cutoff);
          }
        }
      }
      return truncated;
    }),
  };
}
