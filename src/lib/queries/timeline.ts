/**
 * Timeline agrégée par prospect — fiche historique 360° Phase 1+2+3.
 *
 * Agrège plusieurs sources hétérogènes en un seul fil chronologique
 * descending :
 *   - pipeline_transitions (Phase 1)
 *   - followups (Phase 1)
 *   - appointments (Phase 1)
 *   - lead_emails (Phase 2 — mails sortants v1 SMTP + v2 Hub Gateway)
 *   - call_log (Phase 3 — appels Telnyx inbound/outbound)
 *
 * Phase 2.5 ajoutera : mail_in (lead_emails où direction='incoming'),
 * livré par W8b avec la pipeline IMAP. Le merge sera identique à mail_out,
 * juste filtré sur direction='incoming' et occurredAt = receivedAt.
 *
 * Auth : la route appelante DOIT déjà avoir validé requireUser() + filtré le
 * tenant. Ce module suppose `tenantId` strict (jamais null) — pas de fallback
 * vers le tenant default qui exposerait du cross-tenant.
 */
import { prisma } from "@/lib/prisma";

const BODY_PREVIEW_MAX = 220;

function buildBodyPreview(bodyText: string | null, bodyHtml: string | null): string | null {
  const raw = bodyText ?? bodyHtml ?? null;
  if (!raw) return null;
  const stripped = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return null;
  return stripped.length > BODY_PREVIEW_MAX
    ? `${stripped.slice(0, BODY_PREVIEW_MAX)}…`
    : stripped;
}

export type TimelineEvent =
  | {
      type: "pipeline_transition";
      id: string;
      occurredAt: string;
      fromStage: string | null;
      toStage: string;
      userId: string | null;
    }
  | {
      type: "followup";
      id: string;
      occurredAt: string;
      status: string;
      note: string | null;
    }
  | {
      type: "appointment";
      id: string;
      occurredAt: string;
      title: string;
      status: string;
      notes: string | null;
      sourceStage: string | null;
    }
  | {
      type: "mail_out";
      id: string;
      occurredAt: string;
      subject: string | null;
      bodyPreview: string | null;
      templateSlug: string | null;
      fromEmail: string;
      toEmails: string[];
      status: string;
    }
  | {
      type: "call";
      id: string;
      occurredAt: string;
      direction: string;
      status: string;
      durationSeconds: number | null;
      recordingPath: string | null;
      notes: string | null;
      provider: string;
    };

export interface TimelineQueryParams {
  siren: string;
  tenantId: string;
  workspaceFilter?: string[] | null;
  /** Filtre par type (ne renvoie que les types listés). Défaut = tous. */
  types?: Array<TimelineEvent["type"]>;
  /** Date ISO — ne renvoie que les events après cette date (inclus). */
  since?: string | null;
  /** Date ISO — ne renvoie que les events avant cette date (inclus). */
  until?: string | null;
  /** Limite globale (post-merge). Défaut = 200. */
  limit?: number;
}

/**
 * Récupère la timeline agrégée d'un prospect.
 *
 * Implémentation : 3 queries Prisma en parallèle (transitions, followups,
 * appointments), merge en JS, tri par occurredAt desc, limit final. Volume
 * attendu par prospect : ~10-100 events → pas de souci de perf à ce stade.
 * Si un prospect explose (>500 events), passer à un cursor SQL UNION ALL.
 */
export async function getProspectTimeline(
  params: TimelineQueryParams,
): Promise<TimelineEvent[]> {
  const {
    siren,
    tenantId,
    workspaceFilter,
    types,
    since,
    until,
    limit = 200,
  } = params;

  // Validation SIREN — 9 chiffres. La route appelante valide déjà mais on
  // garde une seconde barrière pour les appels internes éventuels.
  if (!/^\d{9}$/.test(siren)) {
    throw new Error(`getProspectTimeline: invalid SIREN ${siren}`);
  }

  // Filtre workspace : `null` (admin "all") = aucun filtre, `[]` = aucun
  // résultat (utilisateur sans workspace), `[ids]` = restrict à ces ids.
  // On normalise pour les .findMany.
  const wsCondition = workspaceFilter === null || workspaceFilter === undefined
    ? undefined
    : workspaceFilter.length === 0
      ? { in: ["__none__"] } // force aucun résultat sans casser Prisma
      : { in: workspaceFilter };

  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(until) : null;
  // Distinction sémantique :
  //  - types === undefined → param absent, on renvoie tous les types
  //  - types === []        → l'appelant a explicitement demandé "rien", on
  //                          n'interroge aucune source (utile après whitelist
  //                          côté route si l'utilisateur a passé que des
  //                          types inconnus)
  const hasTypeFilter = Array.isArray(types);
  const wantType = (t: TimelineEvent["type"]) =>
    !hasTypeFilter || types!.includes(t);

  // 1. Pipeline transitions (table créée par migration 0021)
  const transitions = wantType("pipeline_transition")
    ? await prisma.pipelineTransition.findMany({
        where: {
          siren,
          tenantId,
          ...(wsCondition ? { workspaceId: wsCondition } : {}),
          ...(sinceDate ? { occurredAt: { gte: sinceDate } } : {}),
          ...(untilDate ? { occurredAt: { ...(sinceDate ? { gte: sinceDate } : {}), lte: untilDate } } : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: limit,
      })
    : [];

  // 2. Followups — tenantId est nullable côté Followup, mais en pratique
  // tous les inserts récents le posent. On force le filtre tenantId pour la
  // sécurité RBAC.
  const followups = wantType("followup")
    ? await prisma.followup.findMany({
        where: {
          siren,
          tenantId,
          ...(wsCondition ? { workspaceId: wsCondition } : {}),
        },
        orderBy: { scheduledAt: "desc" },
        take: limit,
      })
    : [];

  // 3. Appointments — tenantId NOT NULL, startAt = Timestamptz.
  const appointments = wantType("appointment")
    ? await prisma.appointment.findMany({
        where: {
          siren,
          tenantId,
          ...(wsCondition ? { workspaceId: wsCondition } : {}),
          ...(sinceDate ? { startAt: { gte: sinceDate } } : {}),
          ...(untilDate ? { startAt: { ...(sinceDate ? { gte: sinceDate } : {}), lte: untilDate } } : {}),
        },
        orderBy: { startAt: "desc" },
        take: limit,
      })
    : [];

  // 4. Mails sortants — table `lead_emails`, direction='outgoing'.
  // sentAt nullable (queued/failed peuvent rester sans sentAt) → fallback
  // createdAt. siren nullable côté schéma → filtre strict siren=<id>.
  const mailsOut = wantType("mail_out")
    ? await prisma.leadEmail.findMany({
        where: {
          siren,
          tenantId,
          direction: "outgoing",
          ...(wsCondition ? { workspaceId: wsCondition } : {}),
        },
        orderBy: { sentAt: "desc" },
        take: limit,
      })
    : [];

  // 5. Appels Telnyx — `call_log`. startedAt est un `String` Prisma (legacy
  // schema sans @db.Timestamptz), donc on ne peut PAS filtrer since/until côté
  // SQL — post-merge uniquement (cf. pattern followups). tenantId NOT NULL
  // imposé en filtre malgré le ? côté schéma : RBAC strict.
  const calls = wantType("call")
    ? await prisma.callLog.findMany({
        where: {
          siren,
          tenantId,
          ...(wsCondition ? { workspaceId: wsCondition } : {}),
        },
        orderBy: { startedAt: "desc" },
        take: limit,
      })
    : [];

  // Normalisation → TimelineEvent[]
  const events: TimelineEvent[] = [
    ...transitions.map((t): TimelineEvent => ({
      type: "pipeline_transition",
      id: t.id,
      occurredAt: t.occurredAt.toISOString(),
      fromStage: t.fromStage,
      toStage: t.toStage,
      userId: t.userId,
    })),
    ...followups.map((f): TimelineEvent => ({
      type: "followup",
      id: String(f.id),
      // followup.scheduledAt est un String (datetime sérialisé) côté Prisma.
      occurredAt: f.scheduledAt,
      status: f.status,
      note: f.note,
    })),
    ...appointments.map((a): TimelineEvent => ({
      type: "appointment",
      id: a.id,
      occurredAt: a.startAt.toISOString(),
      title: a.title,
      status: a.status,
      notes: a.notes,
      sourceStage: a.sourceStage,
    })),
    ...mailsOut.map((m): TimelineEvent => ({
      type: "mail_out",
      id: m.id,
      // Fallback createdAt si sentAt null (queued/failed).
      occurredAt: (m.sentAt ?? m.createdAt).toISOString(),
      subject: m.subject,
      bodyPreview: buildBodyPreview(m.bodyText, m.bodyHtml),
      templateSlug: m.templateSlug,
      fromEmail: m.fromEmail,
      toEmails: m.toEmails,
      status: m.sentStatus,
    })),
    ...calls.map((c): TimelineEvent => ({
      type: "call",
      id: String(c.id),
      // startedAt est déjà un String ISO côté schéma.
      occurredAt: c.startedAt,
      direction: c.direction,
      status: c.status,
      durationSeconds: c.durationSeconds,
      recordingPath: c.recordingPath,
      notes: c.notes,
      provider: c.provider,
    })),
  ];

  // Filtre date appliqué post-merge sur followups (scheduledAt String, pas
  // facilement filtré côté Prisma).
  const filtered = events.filter((e) => {
    if (sinceDate && new Date(e.occurredAt) < sinceDate) return false;
    if (untilDate && new Date(e.occurredAt) > untilDate) return false;
    return true;
  });

  // Tri descending par date
  filtered.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return filtered.slice(0, limit);
}
