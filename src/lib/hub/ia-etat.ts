/**
 * État de « Mon IA » pour une personne dans une organisation du Hub (CONTRAT-HUB §5.24.1) : `prete` (moteur branché, le cadre
 * répond), `sans_moteur` (carte « Relier mon IA », jamais le cadre), `eteinte` (rien). Hub muet, 5xx, refus ou réponse
 * illisible : `null`, l'écran se tait. Gardé 60 s au plus par (personne, organisation), comme le contrat l'autorise.
 */
import { appelerHub, type Opts } from "@/lib/liaisons/hub";

export type EtatMonIA = "prete" | "sans_moteur" | "eteinte";
export type AffichageMonIA = "cadre" | "carte" | null;

const GARDE_MS = 60_000;
const cache = new Map<string, { etat: EtatMonIA | null; jusque: number }>();

/** La règle d'affichage, en un seul endroit : sans moteur, jamais le cadre. */
export function affichageMonIA(etat: EtatMonIA | null | undefined): AffichageMonIA {
  if (etat === "prete") return "cadre";
  if (etat === "sans_moteur") return "carte";
  return null;
}

export async function etatMonIA(hubUserId: string, hubTenantId: string, o: Opts & { sansCache?: boolean } = {}): Promise<EtatMonIA | null> {
  const cle = `${hubUserId}:${hubTenantId}`;
  const maintenant = (o.maintenant ?? Date.now)();
  const garde = cache.get(cle);
  if (!o.sansCache && garde && garde.jusque > maintenant) return garde.etat;
  let etat: EtatMonIA | null = null;
  try {
    const { res, r } = await appelerHub("/api/ia/etat", { hub_user_id: hubUserId, tenant_id: hubTenantId }, o, 2500);
    const e = r?.etat;
    if (res.status === 200 && (e === "prete" || e === "sans_moteur" || e === "eteinte")) etat = e;
    else console.warn(`[ia][etat] refus hub status=${res.status} erreur=${String(r?.error ?? "").slice(0, 40)}`);
  } catch {
    console.warn("[ia][etat] hub injoignable");
  }
  if (cache.size > 5000) cache.clear();
  // Un échec n'est gardé que 10 s : un Hub qui revient remet vite la fenêtre.
  cache.set(cle, { etat, jusque: maintenant + (etat ? GARDE_MS : 10_000) });
  return etat;
}
