/**
 * Coordonnées d'un compte gratuit, hors programme (VER-249) : à l'écran, par une IA, par lot. ÉTEINT tant que Robert n'a pas
 * choisi : `ATLAS_GRATUIT_COORDONNEES` vide ou illisible laisse l'état d'avant.
 *  - `masque` : emails et téléphones retirés de toute sortie, et on ne filtre pas sur leur texte ;
 *  - `fiches:N` : pareil dans les listes, mais N fiches distinctes par jour et par espace montrent les leurs.
 * Un plan payant ou l'accès avancé n'est jamais concerné. Un plan illisible compte pour gratuit.
 *
 * Mesure (allumé ou non) : chaque sortie d'un compte gratuit qui porte des coordonnées écrit une ligne
 * `[atlas][coordonnees]` (outil, espace, réglage, fiches demandées, fiches montrées), des nombres seulement.
 * C'est l'usage réel d'où se tire le plafond : `obs search '\[atlas\]\[coordonnees\]' --since 720h`.
 */
import { consommer, minuitParis, rendre } from "@/lib/compteurs";
import { compterCoordonnees, retirerCoordonnees } from "@/lib/mcp/coordonnees";
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
  if (c.droits?.payant || c.droits?.accesAvance) return outil.run(a, c);
  const r = reglageGratuit();
  const libre = !r || (outil.name === FICHE && (await ficheOfferte(c.ctx.tenantId, String(a.siren), r.fiches)));
  const brut = libre ? await outil.run(a, c) : await enRestreint(() => outil.run(a, c), ORIENTATION_GRATUIT);
  const demandees = compterCoordonnees(brut);
  const v = libre ? brut : retirerCoordonnees(brut, ORIENTATION_GRATUIT);
  if (demandees) {
    const reglage = r ? (r.fiches ? `fiches:${r.fiches}` : "masque") : "aucun";
    console.info(`[atlas][coordonnees] outil=${outil.name} tenant=${c.ctx.tenantId} plan=${c.droits?.plan ?? "aucun"} reglage=${reglage} demandees=${demandees} montrees=${libre ? demandees : 0}`);
  }
  return v;
}
