import { prisma, bigIntToNumber, tenantWhere, DEFAULT_ENTREPRISES_WHERE } from "./shared";
import { pipelineStageForStatus } from "@/lib/outreach/status";

/**
 * Insère une row dans pipeline_transitions si toStage diffère réellement de
 * fromStage (sinon = update qui ne touche pas le stage, on ne pollue pas).
 * Best-effort : un échec d'insert ne doit JAMAIS bloquer la mutation outreach.
 * La timeline tolère un trou ; l'inverse (échec de patch parce qu'on n'a pas
 * pu logger) serait inacceptable. Erreur loggée en console pour debug.
 *
 * Le model Prisma est injecté en 2e argument pour testabilité (cf
 * pipeline-internal-testing.ts). En prod : prisma.pipelineTransition direct.
 */
async function recordPipelineTransition(
  params: {
    siren: string;
    tenantId: string;
    workspaceId: string | null;
    userId: string | null;
    fromStage: string | null;
    toStage: string;
  },
  model: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } = prisma.pipelineTransition,
): Promise<void> {
  // Pas de transition si stage inchangé (évite spam timeline sur simple
  // édition notes/qualif sans mouvement kanban).
  if (params.fromStage === params.toStage) return;
  try {
    await model.create({
      data: {
        siren: params.siren,
        tenantId: params.tenantId,
        workspaceId: params.workspaceId,
        userId: params.userId,
        fromStage: params.fromStage,
        toStage: params.toStage,
      },
    });
  } catch (err) {
    // Best-effort : on garde la trace en logs mais on n'échoue pas la mutation.
    console.warn("[pipeline-transition] insert failed (non-blocking):", err);
  }
}

// Export interne pour tests Vitest — pas un contrat public, ne pas
// consommer depuis le code applicatif.
export const __pipelineTestingInternals = { recordPipelineTransition };

export interface PipelineLead {
  /** Alias legacy: front-end PipelineBoard reads `domain` to key/select leads. */
  domain: string;
  siren: string;
  web_domain?: string | null;
  nom_entreprise: string;
  dirigeant: string;
  phone: string | null;
  email: string | null;
  dirigeant_email: string | null;
  ville: string | null;
  departement: string | null;
  outreach_status: string;
  outreach_notes: string | null;
  contacted_date: string | null;
  contact_method: string | null;
  qualification: number | null;
  last_visited: string | null;
  ca: number | null;
  effectifs: string | null;
  cms: string | null;
  pending_followups: number;
  // New pipeline fields
  pipeline_stage: string | null;
  interest_pct: number | null;
  deadline: string | null;
  site_price: number | null;
  acompte_pct: number | null;
  acompte_amount: number | null;
  monthly_recurring: number | null;
  annual_deal: boolean | null;
  estimated_value: number | null;
  real_value: number | null;
  upsell_estimated: number | null;
  last_interaction_at: string | null;
}

/** Build a SQL `AND workspace_id IN (...)` clause (empty string when no filter). */
function workspaceSqlClause(alias: string, workspaceFilter: string[] | null | undefined): string {
  if (workspaceFilter === null || workspaceFilter === undefined) return "";
  if (workspaceFilter.length === 0) return " AND FALSE";
  const ids = workspaceFilter.map((w) => `'${w.replace(/'/g, "''")}'`).join(",");
  return ` AND ${alias}.workspace_id IN (${ids})`;
}

export async function getPipelineLeads(
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
  userFilter: string | null = null,
): Promise<Record<string, PipelineLead[]>> {
  const tw = tenantWhere("o", tenantId);
  const twF = tenantWhere("f", tenantId);
  const wsO = workspaceSqlClause("o", workspaceFilter);
  const wsF = workspaceSqlClause("f", workspaceFilter);
  // Validation UUID stricte avant interpolation (anti SQL injection).
  if (userFilter && !/^[0-9a-f-]{36}$/i.test(userFilter)) {
    throw new Error(`getPipelineLeads: invalid userFilter format: ${userFilter}`);
  }
  const rows = await prisma.$queryRawUnsafe<PipelineLead[]>(`
    SELECT
      e.siren,
      e.siren as domain,
      COALESCE(
        e.web_domain_normalized,
        e.web_domain,
        (SELECT (elt->>'domain') FROM jsonb_array_elements(e.web_domains_all) elt WHERE (elt->>'is_primary')::boolean = true LIMIT 1),
        (SELECT (elt->>'domain') FROM jsonb_array_elements(e.web_domains_all) elt LIMIT 1)
      ) as web_domain,
      COALESCE(e.denomination, '') as nom_entreprise,
      TRIM(COALESCE(e.dirigeant_prenom,'') || ' ' || COALESCE(e.dirigeant_nom,'')) as dirigeant,
      e.best_phone_e164 as phone,
      e.best_email_normalized as email,
      NULL::text as dirigeant_email,
      e.commune as ville,
      e.departement as departement,
      o.status as outreach_status,
      o.notes as outreach_notes,
      o.contacted_date,
      o.contact_method,
      o.qualification,
      o.last_visited,
      o.pipeline_stage,
      o.interest_pct,
      o.deadline::text as deadline,
      o.site_price::numeric as site_price,
      o.acompte_pct,
      o.acompte_amount::numeric as acompte_amount,
      o.monthly_recurring::numeric as monthly_recurring,
      o.annual_deal,
      o.estimated_value::numeric as estimated_value,
      o.real_value::numeric as real_value,
      o.upsell_estimated::numeric as upsell_estimated,
      o.last_interaction_at::text as last_interaction_at,
      e.chiffre_affaires as ca,
      e.tranche_effectifs as effectifs,
      e.web_cms as cms,
      (SELECT COUNT(*) FROM followups f WHERE f.siren = e.siren AND f.status = 'pending' AND ${twF}${wsF}) as pending_followups
    FROM outreach o
    JOIN entreprises e ON o.siren = e.siren
    WHERE o.status != 'a_contacter' AND ${tw}${wsO}
      ${userFilter ? `AND o.user_id = '${userFilter}'` : ""}
      AND ${DEFAULT_ENTREPRISES_WHERE}
    ORDER BY o.position ASC, o.updated_at DESC
  `);

  const normalized = rows.map(row => ({
    ...row,
    ca: row.ca !== null ? Number(row.ca) : null,
    pending_followups: bigIntToNumber(row.pending_followups),
    // Pipeline numeric fields come as strings from raw SQL — force Number
    estimated_value: row.estimated_value != null ? Number(row.estimated_value) : null,
    real_value: row.real_value != null ? Number(row.real_value) : null,
    site_price: row.site_price != null ? Number(row.site_price) : null,
    acompte_amount: row.acompte_amount != null ? Number(row.acompte_amount) : null,
    monthly_recurring: row.monthly_recurring != null ? Number(row.monthly_recurring) : null,
    upsell_estimated: row.upsell_estimated != null ? Number(row.upsell_estimated) : null,
    interest_pct: row.interest_pct != null ? Number(row.interest_pct) : null,
  }));

  // Group : pipeline_stage si présent et non-trivial (= n'importe quel slug
  // écrit explicitement par le commercial, qu'il soit canonique ou custom),
  // sinon retombe sur le status legacy. Avant 2026-05-23 cette liste était
  // hardcodée à 9 slugs canoniques — depuis l'introduction des stages
  // custom par workspace (ticket pipeline-stages-customisables), on accepte
  // n'importe quel slug : si l'admin a créé "rdv_planifie" dans son
  // workspace, on doit grouper les leads dessus tels quels.
  //
  // Garde-fou : on filtre quand même les valeurs vides et la sentinelle
  // legacy `a_contacter` (lead non encore traité, pas censé apparaître).
  const pipeline: Record<string, PipelineLead[]> = {};
  for (const row of normalized) {
    const ps = (row.pipeline_stage || "").trim();
    // Si pipeline_stage est vide OU vaut "a_contacter", on retombe sur
    // outreach_status (legacy) — préserve les leads pré-2026-04-15 qui
    // n'avaient que outreach_status.
    const stage =
      ps && ps !== "a_contacter" ? ps : (row.outreach_status || "a_contacter");
    if (stage === "a_contacter") continue; // skip ungrouped
    if (!pipeline[stage]) pipeline[stage] = [];
    pipeline[stage].push(row);
  }
  return pipeline;
}

export async function updateOutreach(
  siren: string,
  data: { status: string; notes: string; contact_method: string; contacted_date: string; qualification: number | null },
  tenantId: string | null = null,
  workspaceId: string | null = null,
  userId: string | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const wid = workspaceId ?? null;
  const uid = userId ?? null;
  // Sync : pipeline_stage dérivé du status (mapping canonique).
  const pipelineStage = pipelineStageForStatus(data.status);

  // Capture le stage actuel AVANT update — sert au hook pipeline_transitions
  // pour reconstruire from_stage → to_stage. null si la row n'existait pas
  // (cas premier contact).
  const prev = await prisma.outreach.findUnique({
    where: { siren_tenantId: { siren, tenantId: effectiveTid } },
    select: { pipelineStage: true },
  });

  await prisma.$executeRaw`
    INSERT INTO outreach (siren, tenant_id, workspace_id, status, pipeline_stage, notes, contact_method, contacted_date, qualification, updated_at, user_id, last_interaction_at)
    VALUES (${siren}, ${effectiveTid}::uuid, ${wid}::uuid, ${data.status}, ${pipelineStage}, ${data.notes}, ${data.contact_method}, ${data.contacted_date}, ${data.qualification}, ${now}, ${uid}::uuid, NOW())
    ON CONFLICT(siren, tenant_id) DO UPDATE SET
      status = EXCLUDED.status,
      pipeline_stage = EXCLUDED.pipeline_stage,
      notes = EXCLUDED.notes,
      contact_method = EXCLUDED.contact_method,
      contacted_date = EXCLUDED.contacted_date,
      qualification = EXCLUDED.qualification,
      updated_at = EXCLUDED.updated_at,
      last_interaction_at = NOW(),
      workspace_id = COALESCE(outreach.workspace_id, EXCLUDED.workspace_id),
      user_id = COALESCE(EXCLUDED.user_id, outreach.user_id)
  `;

  await recordPipelineTransition({
    siren,
    tenantId: effectiveTid,
    workspaceId: wid,
    userId: uid,
    fromStage: prev?.pipelineStage ?? null,
    toStage: pipelineStage,
  });
}

export async function patchOutreach(
  siren: string,
  data: {
    status?: string; notes?: string; contact_method?: string; contacted_date?: string; qualification?: number | null;
    pipeline_stage?: string; interest_pct?: number; deadline?: string;
    site_price?: number; acompte_pct?: number; acompte_amount?: number;
    monthly_recurring?: number; annual_deal?: boolean;
    estimated_value?: number; real_value?: number; upsell_estimated?: number;
  },
  tenantId: string | null = null,
  workspaceId: string | null = null,
  userId: string | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";

  const existing = await prisma.outreach.findFirst({
    where: { siren, tenantId: effectiveTid },
  });

  // Build raw SQL SET clauses for new pipeline fields (not in Prisma schema yet)
  const pipelineFields: string[] = [];
  const pipelineValues: unknown[] = [];
  let pIdx = 1;
  if (data.pipeline_stage !== undefined) { pipelineFields.push(`pipeline_stage = $${pIdx++}`); pipelineValues.push(data.pipeline_stage); }
  if (data.interest_pct !== undefined) { pipelineFields.push(`interest_pct = $${pIdx++}`); pipelineValues.push(data.interest_pct); }
  if (data.deadline !== undefined) { pipelineFields.push(`deadline = $${pIdx++}::date`); pipelineValues.push(data.deadline || null); }
  if (data.site_price !== undefined) { pipelineFields.push(`site_price = $${pIdx++}`); pipelineValues.push(data.site_price); }
  if (data.acompte_pct !== undefined) { pipelineFields.push(`acompte_pct = $${pIdx++}`); pipelineValues.push(data.acompte_pct); }
  if (data.acompte_amount !== undefined) { pipelineFields.push(`acompte_amount = $${pIdx++}`); pipelineValues.push(data.acompte_amount); }
  if (data.monthly_recurring !== undefined) { pipelineFields.push(`monthly_recurring = $${pIdx++}`); pipelineValues.push(data.monthly_recurring); }
  if (data.annual_deal !== undefined) { pipelineFields.push(`annual_deal = $${pIdx++}`); pipelineValues.push(data.annual_deal); }
  if (data.estimated_value !== undefined) { pipelineFields.push(`estimated_value = $${pIdx++}`); pipelineValues.push(data.estimated_value); }
  if (data.real_value !== undefined) { pipelineFields.push(`real_value = $${pIdx++}`); pipelineValues.push(data.real_value); }
  if (data.upsell_estimated !== undefined) { pipelineFields.push(`upsell_estimated = $${pIdx++}`); pipelineValues.push(data.upsell_estimated); }

  // Cohérence status ↔ pipeline_stage : si l'un est fourni, on synchronise
  // l'autre via le helper canonique (cf src/lib/outreach/status.ts).
  // - status fourni → recalcul pipeline_stage à partir de la table de mapping
  // - pipeline_stage fourni explicitement → écrase status par la valeur
  //   canonique (drag&drop kanban veut imposer le stage).
  // C'est la fin des désync de type (status='hors_cible', pipeline_stage='fiche_ouverte').
  let syncedStatus = data.status;
  let syncedPipelineStage = data.pipeline_stage;
  if (data.status !== undefined && data.pipeline_stage === undefined) {
    syncedPipelineStage = pipelineStageForStatus(data.status);
  } else if (data.pipeline_stage !== undefined && data.status === undefined) {
    syncedStatus = data.pipeline_stage;
  }

  // Snapshot du stage AVANT update — sert au hook pipeline_transitions
  // pour reconstruire from_stage → to_stage. null = pas de row existante.
  const previousStage = existing?.pipelineStage ?? null;

  if (existing) {
    // Standard Prisma fields
    const updateData: Record<string, unknown> = { updatedAt: now };
    if (syncedStatus !== undefined) updateData.status = syncedStatus;
    // Notes: prepend new note to existing (historical log, not replace)
    if (data.notes !== undefined) {
      const existingNotes = existing.notes || "";
      const separator = existingNotes ? "\n---\n" : "";
      updateData.notes = data.notes + separator + existingNotes;
    }
    if (data.contact_method !== undefined) updateData.contactMethod = data.contact_method;
    if (data.contacted_date !== undefined) updateData.contactedDate = data.contacted_date;
    if (data.qualification !== undefined) updateData.qualification = data.qualification;
    if (userId) updateData.userId = userId;

    await prisma.outreach.update({
      where: { siren_tenantId: { siren, tenantId: effectiveTid } },
      data: updateData,
    });

    // Sync pipeline_stage si nécessaire (toujours, dès qu'on touche le status)
    const pipelineSetParts: string[] = [];
    const pipelineSetVals: unknown[] = [];
    let qIdx = 1;
    if (syncedPipelineStage !== undefined) {
      pipelineSetParts.push(`pipeline_stage = $${qIdx++}`);
      pipelineSetVals.push(syncedPipelineStage);
    }
    if (data.interest_pct !== undefined) { pipelineSetParts.push(`interest_pct = $${qIdx++}`); pipelineSetVals.push(data.interest_pct); }
    if (data.deadline !== undefined) { pipelineSetParts.push(`deadline = $${qIdx++}::date`); pipelineSetVals.push(data.deadline || null); }
    if (data.site_price !== undefined) { pipelineSetParts.push(`site_price = $${qIdx++}`); pipelineSetVals.push(data.site_price); }
    if (data.acompte_pct !== undefined) { pipelineSetParts.push(`acompte_pct = $${qIdx++}`); pipelineSetVals.push(data.acompte_pct); }
    if (data.acompte_amount !== undefined) { pipelineSetParts.push(`acompte_amount = $${qIdx++}`); pipelineSetVals.push(data.acompte_amount); }
    if (data.monthly_recurring !== undefined) { pipelineSetParts.push(`monthly_recurring = $${qIdx++}`); pipelineSetVals.push(data.monthly_recurring); }
    if (data.annual_deal !== undefined) { pipelineSetParts.push(`annual_deal = $${qIdx++}`); pipelineSetVals.push(data.annual_deal); }
    if (data.estimated_value !== undefined) { pipelineSetParts.push(`estimated_value = $${qIdx++}`); pipelineSetVals.push(data.estimated_value); }
    if (data.real_value !== undefined) { pipelineSetParts.push(`real_value = $${qIdx++}`); pipelineSetVals.push(data.real_value); }
    if (data.upsell_estimated !== undefined) { pipelineSetParts.push(`upsell_estimated = $${qIdx++}`); pipelineSetVals.push(data.upsell_estimated); }

    if (pipelineSetParts.length > 0) {
      pipelineSetParts.push(`last_interaction_at = NOW()`);
      const setClause = pipelineSetParts.join(", ");
      await prisma.$executeRawUnsafe(
        `UPDATE outreach SET ${setClause} WHERE siren = $${qIdx++} AND tenant_id = $${qIdx++}::uuid`,
        ...pipelineSetVals, siren, effectiveTid
      );
    }
    // Note : `pipelineFields`/`pipelineValues` ci-dessus (loop pIdx) sont
    // désormais ignorés au profit de pipelineSetParts qui inclut la sync
    // status/pipeline_stage. Variables conservées pour minimiser le diff.
    void pipelineFields;
    void pipelineValues;
  } else {
    // Nouvelle ligne : on force la cohérence dès l'insert.
    const initialStatus = syncedStatus ?? "a_contacter";
    const initialStage = syncedPipelineStage ?? pipelineStageForStatus(initialStatus);
    await prisma.outreach.create({
      data: {
        siren,
        status: initialStatus,
        notes: data.notes ?? "",
        contactMethod: data.contact_method ?? "",
        contactedDate: data.contacted_date ?? "",
        qualification: data.qualification ?? null,
        updatedAt: now,
        tenantId: effectiveTid,
        workspaceId,
        userId,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE outreach SET pipeline_stage = $1, last_interaction_at = NOW() WHERE siren = $2 AND tenant_id = $3::uuid`,
      initialStage, siren, effectiveTid
    );
  }

  // Hook timeline 360° — log la transition de stage si elle a vraiment changé.
  // syncedPipelineStage est l'état cible visé par le patch ; previousStage est
  // l'état avant (peut être null si nouvelle row). On déduit le stage effectif
  // final = syncedPipelineStage si fourni, sinon previousStage (pas de
  // changement) sinon pipelineStage initial à la création.
  const effectiveToStage =
    syncedPipelineStage ?? previousStage ?? pipelineStageForStatus(syncedStatus ?? "a_contacter");
  await recordPipelineTransition({
    siren,
    tenantId: effectiveTid,
    workspaceId: workspaceId ?? existing?.workspaceId ?? null,
    userId: userId ?? null,
    fromStage: previousStage,
    toStage: effectiveToStage,
  });
}

export async function recordVisit(
  siren: string,
  tenantId: string | null = null,
  workspaceId: string | null = null,
  userId: string | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const wid = workspaceId ?? null;
  const uid = userId ?? null;
  await prisma.$executeRaw`
    INSERT INTO outreach (siren, tenant_id, workspace_id, last_visited, status, user_id, pipeline_stage, last_interaction_at)
    VALUES (${siren}, ${effectiveTid}::uuid, ${wid}::uuid, ${now}, 'fiche_ouverte', ${uid}::uuid, 'fiche_ouverte', NOW())
    ON CONFLICT(siren, tenant_id) DO UPDATE SET
      last_visited = EXCLUDED.last_visited,
      last_interaction_at = NOW(),
      status = CASE
        WHEN outreach.status IS NULL OR outreach.status = '' OR outreach.status = 'a_contacter'
        THEN 'fiche_ouverte'
        ELSE outreach.status
      END,
      pipeline_stage = CASE
        WHEN outreach.pipeline_stage IS NULL OR outreach.pipeline_stage = '' OR outreach.pipeline_stage = 'a_contacter'
        THEN 'fiche_ouverte'
        ELSE outreach.pipeline_stage
      END,
      workspace_id = COALESCE(outreach.workspace_id, EXCLUDED.workspace_id),
      user_id = COALESCE(EXCLUDED.user_id, outreach.user_id)
  `;
}

export async function getPipelineColumnOrder(tenantId: string | null = null): Promise<string[] | null> {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const row = await prisma.pipelineConfig.findUnique({
    where: { key_tenantId: { key: "column_order", tenantId: effectiveTid } },
  });
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export async function savePipelineColumnOrder(order: string[], tenantId: string | null = null) {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  await prisma.$executeRaw`
    INSERT INTO pipeline_config (key, tenant_id, value) VALUES ('column_order', ${effectiveTid}::uuid, ${JSON.stringify(order)})
    ON CONFLICT(key, tenant_id) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function reorderPipelineCards(
  status: string,
  sirens: string[],
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const tw = tenantWhere("outreach", tenantId);
  const ws = workspaceSqlClause("outreach", workspaceFilter);
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";

  // Snapshot des stages AVANT update — sert au hook pipeline_transitions
  // pour ne logger que les vrais changements (sirens déplacés inter-colonne).
  // Drag-drop intra-colonne (réordonner = même status) ne crée pas de
  // transition grâce au early-return dans recordPipelineTransition.
  const before = sirens.length > 0
    ? await prisma.outreach.findMany({
        where: { siren: { in: sirens }, tenantId: effectiveTid },
        select: { siren: true, pipelineStage: true, workspaceId: true },
      })
    : [];
  const beforeMap = new Map(before.map(r => [r.siren, r]));

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < sirens.length; i++) {
      await tx.$executeRawUnsafe(
        `UPDATE outreach SET position = $1, status = $2, pipeline_stage = $2, updated_at = $3, last_interaction_at = NOW() WHERE siren = $4 AND ${tw}${ws}`,
        i, status, now, sirens[i]
      );
    }
  });

  // Hook timeline 360° — INSERT en parallèle, best-effort par siren.
  await Promise.all(sirens.map(siren => {
    const prev = beforeMap.get(siren);
    return recordPipelineTransition({
      siren,
      tenantId: effectiveTid,
      workspaceId: prev?.workspaceId ?? null,
      userId: null, // reorder n'a pas de user attaché dans cette signature
      fromStage: prev?.pipelineStage ?? null,
      toStage: status,
    });
  }));
}

export async function batchReorderPipelineCards(
  columns: { status: string; sirens: string[] }[],
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const tw = tenantWhere("outreach", tenantId);
  const ws = workspaceSqlClause("outreach", workspaceFilter);
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";

  // Snapshot global des stages AVANT update.
  const allSirens = columns.flatMap(c => c.sirens);
  const before = allSirens.length > 0
    ? await prisma.outreach.findMany({
        where: { siren: { in: allSirens }, tenantId: effectiveTid },
        select: { siren: true, pipelineStage: true, workspaceId: true },
      })
    : [];
  const beforeMap = new Map(before.map(r => [r.siren, r]));

  await prisma.$transaction(async (tx) => {
    for (const col of columns) {
      for (let i = 0; i < col.sirens.length; i++) {
        await tx.$executeRawUnsafe(
          `UPDATE outreach SET position = $1, status = $2, pipeline_stage = $2, updated_at = $3, last_interaction_at = NOW() WHERE siren = $4 AND ${tw}${ws}`,
          i, col.status, now, col.sirens[i]
        );
      }
    }
  });

  // Hook timeline 360° — log toutes les transitions inter-colonne en parallèle.
  await Promise.all(columns.flatMap(col =>
    col.sirens.map(siren => {
      const prev = beforeMap.get(siren);
      return recordPipelineTransition({
        siren,
        tenantId: effectiveTid,
        workspaceId: prev?.workspaceId ?? null,
        userId: null,
        fromStage: prev?.pipelineStage ?? null,
        toStage: col.status,
      });
    })
  ));
}
