// ============================================================================
// search/auth.ts — Authentification machine-to-machine du moteur de recherche IA.
//
// L'API /api/search/* est consommée par une IA / un agent (pas un humain en
// session navigateur, pas le Hub). On utilise un bearer token dédié, comparé en
// timing-safe (réutilise verifyLegacyBearer du module HMAC Hub).
//
// Secret : SEARCH_API_SECRET (env). Fallback toléré sur TENANT_API_SECRET pour
// ne pas bloquer en local si le dédié n'est pas posé, mais le dédié est préféré
// (rotation indépendante du secret cross-app).
//
// multi-tenant-ready : le helper extrait le tenant_id de la requête (V1 =
// "veridian" par défaut). Quand on ouvrira aux clients, chaque clé sera mappée
// à un tenant et `resolveTenant` consultera ce mapping au lieu du défaut.
// ============================================================================

import { verifyLegacyBearer } from "@/lib/hub/hmac";

export const DEFAULT_SEARCH_TENANT = "veridian";

function getSearchSecret(): string | undefined {
  return process.env.SEARCH_API_SECRET || process.env.TENANT_API_SECRET;
}

export interface SearchAuthResult {
  ok: boolean;
  status: number;
  tenantId: string;
  error?: string;
}

/**
 * Authentifie une requête machine du moteur de recherche.
 * - Vérifie le bearer token (timing-safe).
 * - Résout le tenant_id (V1 : "veridian" ; multi-tenant : à mapper par clé).
 */
export function authenticateSearch(req: Request): SearchAuthResult {
  const secret = getSearchSecret();
  if (!secret) {
    return { ok: false, status: 500, tenantId: "", error: "Search API secret not configured" };
  }
  const auth = req.headers.get("authorization");
  const v = verifyLegacyBearer(secret, auth);
  if (!v.ok) {
    return { ok: false, status: 401, tenantId: "", error: "Unauthorized" };
  }
  // V1 : tenant unique Veridian. Header X-Tenant-Id toléré (multi-tenant-ready),
  // mais ignoré tant qu'on n'a pas le mapping clé→tenant (sécurité : un seul
  // tenant autorisé en V1, pas d'usurpation possible).
  const tenantId = DEFAULT_SEARCH_TENANT;
  return { ok: true, status: 200, tenantId };
}
