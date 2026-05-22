/**
 * Source de vérité unique pour la transition d'un outreach entre statuts.
 *
 * Contexte : la table `outreach` a 2 colonnes status historiquement :
 *   - `status`         : 24 valeurs legacy (a_contacter, fiche_ouverte, appele,
 *                         rappeler, interesse, hors_cible, pas_interesse, etc.)
 *   - `pipeline_stage` : 8 stages canoniques du kanban (fiche_ouverte,
 *                         a_rappeler, site_demo, acompte, finition, client,
 *                         upsell, archive) — sous-ensemble fonctionnel.
 *
 * Avant ce module, chaque writer (phone webhook, mail send, lead-sheet
 * dismiss, drag&drop kanban, recordVisit) écrivait l'une OU l'autre des
 * colonnes, jamais les 2 cohéremment → 66 lignes désync sur staging,
 * /historique affichait `status='hors_cible'` mais le kanban gardait
 * `pipeline_stage='fiche_ouverte'`.
 *
 * Maintenant : toute écriture passe par `applyStatusTransition()` qui :
 *   1. Accepte un `event` métier (= ce qui s'est passé : "fiche visitée",
 *      "appel passé", "RDV pris", "marqué hors cible", etc.)
 *   2. Retourne la paire `(status, pipeline_stage)` cohérente
 *   3. Respecte la règle de progression : un event ne peut PAS faire
 *      régresser le pipeline (ex: appel sur un lead déjà en `acompte` ne
 *      retombe pas en `appele`).
 */

import { Prisma } from "@prisma/client";

/** Stages canoniques du kanban (sous-ensemble fonctionnel). */
export const PIPELINE_STAGES = [
  "fiche_ouverte",
  "repondeur",
  "a_rappeler",
  "site_demo",
  "acompte",
  "finition",
  "client",
  "upsell",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages terminaux qui sortent le lead du funnel actif. */
export const TERMINAL_STAGES = [
  "archive",
  "pas_interesse",
  "hors_cible",
] as const;
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

/** Ordre de progression du funnel (plus l'index est haut, plus c'est avancé). */
const STAGE_ORDER: Record<string, number> = {
  a_contacter: 0,
  fiche_ouverte: 1,
  repondeur: 2,
  appele: 2,           // legacy → équivalent repondeur côté funnel
  a_rappeler: 3,
  rappeler: 3,         // legacy
  interesse: 4,        // legacy
  rdv: 4,              // legacy
  site_demo: 5,
  acompte: 6,
  finition: 7,
  client: 8,
  upsell: 9,
  // Terminaux : index très haut pour bloquer les retours (sauf reset explicite)
  archive: 100,
  pas_interesse: 100,
  hors_cible: 100,
};

function rank(stage: string | null | undefined): number {
  if (!stage) return 0;
  return STAGE_ORDER[stage] ?? 0;
}

/**
 * Mapping `status` → `pipeline_stage` correspondant. Pour chaque valeur
 * status legacy, donne le stage canonique le plus proche dans le funnel.
 */
const STATUS_TO_PIPELINE: Record<string, PipelineStage | TerminalStage> = {
  a_contacter: "fiche_ouverte",
  fiche_ouverte: "fiche_ouverte",
  repondeur: "repondeur",
  appele: "repondeur",
  rappeler: "a_rappeler",
  a_rappeler: "a_rappeler",
  interesse: "site_demo",
  rdv: "site_demo",
  site_demo: "site_demo",
  acompte: "acompte",
  finition: "finition",
  client: "client",
  upsell: "upsell",
  archive: "archive",
  pas_interesse: "pas_interesse",
  hors_cible: "hors_cible",
  contacte: "repondeur",
  qualified: "a_rappeler",
  disqualifie: "hors_cible",
  non_qualifie: "hors_cible",
  non_pertinent: "hors_cible",
  email_invalide: "archive",
  rejete: "hors_cible",
  skip: "archive",
  skip_qualifie: "archive",
  a_ignorer: "hors_cible",
  en_attente: "fiche_ouverte",
  en_observation: "a_rappeler",
};

/**
 * Calcule la paire `(status, pipeline_stage)` cohérente pour un new status,
 * en respectant la progression actuelle du lead.
 *
 * @param newStatus Status que l'on veut appliquer (event métier)
 * @param currentStatus Status actuel en DB (pour anti-régression)
 * @param currentPipelineStage Pipeline_stage actuel en DB (pour anti-régression)
 * @returns Paire cohérente à écrire. Si `null` retourné → pas de changement
 *          (anti-régression : on tente d'appliquer "appele" sur un lead déjà
 *          en "acompte", on ignore).
 */
export function applyStatusTransition(
  newStatus: string,
  currentStatus: string | null | undefined = null,
  currentPipelineStage: string | null | undefined = null,
): { status: string; pipeline_stage: string } | null {
  const targetStage = STATUS_TO_PIPELINE[newStatus] ?? "fiche_ouverte";

  // Stages terminaux : toujours forcés (le commercial a le dernier mot).
  if ((TERMINAL_STAGES as readonly string[]).includes(targetStage)) {
    return { status: newStatus, pipeline_stage: targetStage };
  }

  // Anti-régression : si le nouvel event est en arrière du funnel actuel,
  // on conserve l'état actuel. Exemple : appel reçu sur lead déjà en "acompte"
  // → on ignore le downgrade vers "appele".
  const newRank = rank(newStatus);
  const currentRank = Math.max(rank(currentStatus), rank(currentPipelineStage));
  if (currentRank > newRank && currentRank < 100) {
    return null;
  }

  return { status: newStatus, pipeline_stage: targetStage };
}

/**
 * Recalcule le pipeline_stage à partir d'un status arbitraire, sans
 * anti-régression. Utile pour la migration de cleanup et les writers
 * système qui forcent un état (ex: archive auto-cron).
 */
export function pipelineStageForStatus(status: string): string {
  return STATUS_TO_PIPELINE[status] ?? "fiche_ouverte";
}

/**
 * Vérifie qu'un status est une valeur métier connue (clé propre de la table
 * de mapping `STATUS_TO_PIPELINE`). À utiliser pour valider un body API avant
 * écriture : un status inconnu doit partir en 400, jamais atterrir en DB.
 *
 * `hasOwnProperty` (et non l'opérateur `in`) : un body API n'est pas fiable,
 * `"toString"` / `"constructor"` ne doivent pas être acceptés via le
 * prototype d'Object.
 */
export function isKnownStatus(status: unknown): status is string {
  return (
    typeof status === "string" &&
    Object.prototype.hasOwnProperty.call(STATUS_TO_PIPELINE, status)
  );
}

/**
 * Construit le fragment SQL `SET ... ` à appliquer dans un UPDATE outreach
 * pour écrire de façon atomique `status` + `pipeline_stage` + `updated_at`
 * + `last_interaction_at`.
 *
 * À utiliser dans les `$executeRaw` et `$executeRawUnsafe`.
 */
export function buildStatusSetClause(transition: {
  status: string;
  pipeline_stage: string;
}): Prisma.Sql {
  return Prisma.sql`
    status = ${transition.status},
    pipeline_stage = ${transition.pipeline_stage},
    updated_at = NOW()::text,
    last_interaction_at = NOW()
  `;
}
