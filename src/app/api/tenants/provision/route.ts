/**
 * POST /api/tenants/provision — le Hub ouvre l'espace d'un client (CONTRAT-HUB §5.1, VER-263 ; src/lib/hub/ouvrir-espace.ts).
 *
 * Auth : HMAC §6.1 `{ts}.{body}`. Corps : { email, user_id, hub_tenant_id?, plan?, name?, email_proven? } (`metadata.hub_user_id` et
 * `metadata.hub_tenant_id` lus aussi).
 * `plan` absent : aucun plan posé (`plan: null` rendu), ni gratuit ni autre.
 * 200 : tout est là, RELU. `created` et `cree` disent ce que cet appel a créé. Rejouer ne change rien, ni le plan ni le rôle.
 * Refus, rien d'écrit : 400 email_required | hub_user_id_required | invalid_plan | invalid_payload, 401, 409 email_not_linkable | user_deleted |
 * tenant_owned_by_other | tenant_soft_deleted | tenant_suspended | tenant_link_conflict, 429, 503 provision_failed.
 */
import { randomBytes } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { emettreJetonConnexion } from "@/lib/auth/jeton-connexion";
import { UUID_RE } from "@/lib/hub/link-tenant";
import { ouvrirEspace, RefusOuverture } from "@/lib/hub/ouvrir-espace";
import { secretCourant, verifierAppelHub } from "@/lib/hub/secrets";
import { isRateLimited } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const refus = (status: number, error: string, detail: Record<string, unknown> = {}) => NextResponse.json({ error, created: false, ...detail }, { status });

export async function POST(request: NextRequest) {
  if (!secretCourant()) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  const brut = await request.text();
  // La signature d'abord : un inconnu n'apprend rien de ce que la route attend.
  if (!request.headers.get("x-veridian-hub-signature")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const v = verifierAppelHub(request, brut);
  if (!v.ok) return NextResponse.json({ error: v.reason === "timestamp_drift" || v.reason === "invalid_timestamp" ? "Timestamp expired or invalid" : "Invalid signature" }, { status: 401 });

  let c: Record<string, unknown>;
  try {
    c = brut ? JSON.parse(brut) : {};
  } catch {
    return refus(400, "invalid_payload");
  }
  const meta = (c.metadata && typeof c.metadata === "object" ? c.metadata : {}) as Record<string, unknown>;
  const texte = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const email = texte(c.email);
  const hubUserId = (texte(c.user_id) ?? texte(meta.hub_user_id))?.toLowerCase() ?? null;
  const lien = texte(c.hub_tenant_id) ?? texte(meta.hub_tenant_id);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return refus(400, "email_required");
  // Sans identité Hub, rien ne peut être ouvert pour personne : le dire, au lieu de rendre une fausse clé.
  if (!hubUserId || !UUID_RE.test(hubUserId)) return refus(400, "hub_user_id_required");
  if (lien && !UUID_RE.test(lien)) return refus(400, "invalid_payload", { field: "hub_tenant_id" });
  if (isRateLimited(`provision:${hubUserId}`, 10, 60_000)) return refus(429, "Too many requests");

  try {
    const o = await ouvrirEspace({ hubUserId, email, emailProven: c.email_proven === true, hubTenantId: lien?.toLowerCase() ?? null, plan: typeof c.plan === "string" ? c.plan : c.plan === undefined || c.plan === null ? undefined : "illisible", nom: texte(c.name) });
    // 15 min, comme le rebond : un lien resté dans un journal n'ouvre plus la session un jour entier (26/11).
    const { jeton } = await emettreJetonConnexion(o.user_id, 15 * 60 * 1000);
    const { apiKey, cree, ...reste } = o;
    console.log(`[provision] ouvert user=${o.user_id} tenant=${o.tenant_id} hub_tenant=${o.hub_tenant_id ?? "aucun"} plan=${o.plan} cree=${Object.entries(cree).filter(([, x]) => x).map(([k]) => k).join("+") || "rien"}`);
    const app = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
    return NextResponse.json({
      ...reste,
      created: cree.espace,
      cree,
      // Le Hub garde ce champ comme marque « app attachée ». Rejoué, la vraie clé ne se relit pas : une valeur sans usage, dite telle.
      api_key: apiKey ?? randomBytes(32).toString("hex"),
      api_key_minted: apiKey !== null,
      login_url: `${app}/api/auth/token?t=${jeton}`,
    });
  } catch (e) {
    if (e instanceof RefusOuverture) {
      console.warn(`[provision] refus code=${e.code} hub_user=${hubUserId}`);
      return refus(e.statut, e.code, e.detail);
    }
    console.error(`[provision] échec hub_user=${hubUserId} :`, e instanceof Error ? e.message : e);
    return refus(503, "provision_failed");
  }
}
