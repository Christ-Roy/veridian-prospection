/**
 * Coordonnées d'un compte gratuit, hors programme (VER-249) : à l'écran, par une IA, par lot. ÉTEINT tant que Robert n'a pas
 * choisi : `ATLAS_GRATUIT_COORDONNEES` vide ou illisible laisse l'état d'avant.
 *  - `masque` : emails et téléphones retirés de toute sortie, et on ne filtre pas sur leur texte ;
 *  - `fiches:N` : pareil dans les listes, mais N fiches distinctes par jour et par espace montrent les leurs.
 * Un plan payant ou l'accès avancé n'est jamais concerné. Un plan illisible compte pour gratuit.
 */
import { consommer, minuitParis, rendre } from "@/lib/compteurs";
import { retirerCoordonnees } from "@/lib/mcp/coordonnees";
import type { ContexteOutil, Outil } from "@/lib/mcp/outils";

import { enRestreint } from "./restreint";

export const ORIENTATION_GRATUIT = "Emails et téléphones sont réservés aux plans payants Veridian.";
const FICHE = "fiche_entreprise_atlas";

export function reglageGratuit(brut: string | undefined = process.env.ATLAS_GRATUIT_COORDONNEES): { fiches: number } | null {
  const v = (brut ?? "").trim().toLowerCase();
  if (v === "masque") return { fiches: 0 };
  const n = /^fiches:(\d{1,4})$/.exec(v);
  return n ? { fiches: Number(n[1]) } : null;
}

/** Une fiche déjà ouverte aujourd'hui ne recompte pas. */
async function ficheOfferte(tenantId: string, siren: string, plafond: number): Promise<boolean> {
  if (plafond < 1) return false;
  const jour = await minuitParis();
  const vue = `fiche-gratuite:${tenantId}:${siren}`;
  if (!(await consommer(vue, jour, 1, 1)).accepte) return true;
  if ((await consommer(`fiches-gratuites:${tenantId}`, jour, 1, plafond)).accepte) return true;
  await rendre(vue, jour, 1);
  return false;
}

export async function selonPlan(outil: Outil, a: Record<string, unknown>, c: ContexteOutil): Promise<unknown> {
  const r = reglageGratuit();
  if (!r || c.droits?.payant || c.droits?.accesAvance) return outil.run(a, c);
  if (outil.name === FICHE && (await ficheOfferte(c.ctx.tenantId, String(a.siren), r.fiches))) return outil.run(a, c);
  return retirerCoordonnees(await enRestreint(() => outil.run(a, c), ORIENTATION_GRATUIT), ORIENTATION_GRATUIT);
}
