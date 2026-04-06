import { prisma, bigIntToNumber, tenantWhere, DEFAULT_ENTREPRISES_WHERE } from "./shared";

export interface PipelineLead {
  /** Alias legacy: front-end PipelineBoard reads `domain` to key/select leads. */
  domain: string;
  siren: string;
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
  email_count: number;
  pending_followups: number;
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
  const twOe = tenantWhere("oe", tenantId);
  const twF = tenantWhere("f", tenantId);
  const wsO = workspaceSqlClause("o", workspaceFilter);
  const wsF = workspaceSqlClause("f", workspaceFilter);
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
      e.chiffre_affaires as ca,
      e.tranche_effectifs as effectifs,
      e.web_cms as cms,
      (SELECT COUNT(*) FROM outreach_emails oe WHERE oe.siren = e.siren AND ${twOe}) as email_count,
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
    email_count: bigIntToNumber(row.email_count),
    pending_followups: bigIntToNumber(row.pending_followups),
  }));

  const pipeline: Record<string, PipelineLead[]> = {};
  for (const row of normalized) {
    const status = row.outreach_status || "a_contacter";
    if (!pipeline[status]) pipeline[status] = [];
    pipeline[status].push(row);
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
  await prisma.$executeRaw`
    INSERT INTO outreach (siren, tenant_id, workspace_id, status, notes, contact_method, contacted_date, qualification, updated_at, user_id)
    VALUES (${siren}, ${effectiveTid}::uuid, ${wid}::uuid, ${data.status}, ${data.notes}, ${data.contact_method}, ${data.contacted_date}, ${data.qualification}, ${now}, ${uid}::uuid)
    ON CONFLICT(siren, tenant_id) DO UPDATE SET
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      contact_method = EXCLUDED.contact_method,
      contacted_date = EXCLUDED.contacted_date,
      qualification = EXCLUDED.qualification,
      updated_at = EXCLUDED.updated_at,
      workspace_id = COALESCE(outreach.workspace_id, EXCLUDED.workspace_id),
      user_id = COALESCE(EXCLUDED.user_id, outreach.user_id)
  `;
}

export async function patchOutreach(
  siren: string,
  data: { status?: string; notes?: string; contact_method?: string; contacted_date?: string; qualification?: number | null },
  tenantId: string | null = null,
  workspaceId: string | null = null,
  userId: string | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";

  const existing = await prisma.outreach.findFirst({
    where: { siren, tenantId: effectiveTid },
  });

  if (existing) {
    const updateData: Record<string, unknown> = { updatedAt: now };
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.contact_method !== undefined) updateData.contactMethod = data.contact_method;
    if (data.contacted_date !== undefined) updateData.contactedDate = data.contacted_date;
    if (data.qualification !== undefined) updateData.qualification = data.qualification;
    if (userId) updateData.userId = userId;

    await prisma.outreach.update({
      where: { siren_tenantId: { siren, tenantId: effectiveTid } },
      data: updateData,
    });
  } else {
    await prisma.outreach.create({
      data: {
        siren,
        status: data.status ?? "a_contacter",
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
  }
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
    INSERT INTO outreach (siren, tenant_id, workspace_id, last_visited, status, user_id)
    VALUES (${siren}, ${effectiveTid}::uuid, ${wid}::uuid, ${now}, 'fiche_ouverte', ${uid}::uuid)
    ON CONFLICT(siren, tenant_id) DO UPDATE SET
      last_visited = EXCLUDED.last_visited,
      status = CASE
        WHEN outreach.status IS NULL OR outreach.status = '' OR outreach.status = 'a_contacter'
        THEN 'fiche_ouverte'
        ELSE outreach.status
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
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < sirens.length; i++) {
      await tx.$executeRawUnsafe(
        `UPDATE outreach SET position = $1, status = $2, updated_at = $3 WHERE siren = $4 AND ${tw}${ws}`,
        i, status, now, sirens[i]
      );
    }
  });
}

export async function batchReorderPipelineCards(
  columns: { status: string; sirens: string[] }[],
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const tw = tenantWhere("outreach", tenantId);
  const ws = workspaceSqlClause("outreach", workspaceFilter);
  await prisma.$transaction(async (tx) => {
    for (const col of columns) {
      for (let i = 0; i < col.sirens.length; i++) {
        await tx.$executeRawUnsafe(
          `UPDATE outreach SET position = $1, status = $2, updated_at = $3 WHERE siren = $4 AND ${tw}${ws}`,
          i, col.status, now, col.sirens[i]
        );
      }
    }
  });
}
