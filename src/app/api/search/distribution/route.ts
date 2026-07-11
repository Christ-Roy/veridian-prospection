/**
 * POST /api/search/distribution — explorer les distributions comme une vraie DB.
 *
 * Le complément d'/estimate. Deux modes exclusifs :
 *   • { group_by: "<champ>", top?: 20, filters?: {...} }
 *       → top-N des valeurs les plus fréquentes de ce champ (enum/text/bool),
 *         avec volumes actionnables (with_phone / with_email) par valeur.
 *       Ex: { "group_by": "ecom_platform", "filters": { "all": [
 *              { "field": "ecom_level", "op": "eq", "value": "boutique" } ] } }
 *
 *   • { metric: "<champ>", buckets?: 10, filters?: {...} }
 *       → stats de distribution (count/min/max/avg/median/p25/p75/p90) +
 *         histogramme (nb de tranches réglable 3..30) d'un champ numérique.
 *       Ex: { "metric": "chiffre_affaires", "buckets": 12 }
 *
 * group_by et metric sont MUTUELLEMENT EXCLUSIFS. filters est optionnel
 * (défaut = tout le référentiel, hors is_registrar / ca_suspect).
 *
 * Sécurité : le champ DOIT être une clé de FIELD_CATALOG (cf GET
 * /api/search/fields pour le catalogue). Nom de colonne whitelisté, valeurs des
 * filtres bindées $n. Auth bearer machine (SEARCH_API_SECRET) + rate-limit +
 * statement_timeout, identique à /estimate et /companies.
 */
import { NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { authenticateSearch } from "@/lib/search/auth";
import { isStatementTimeout } from "@/lib/search/exec";
import {
  DistributionRequestSchema,
  DistributionValidationError,
  computeDistribution,
} from "@/lib/search/distribution";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = authenticateSearch(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (isRateLimited(`search-distribution:${auth.tenantId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = DistributionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const result = await computeDistribution(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    // Champ mal typé (group_by sur un number, metric sur un text, champ inconnu).
    if (err instanceof DistributionValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (isStatementTimeout(err)) {
      return NextResponse.json(
        { error: "Distribution trop coûteuse à calculer — affine les filtres (secteur, département)." },
        { status: 400 },
      );
    }
    console.error("[search/distribution] query failed", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
