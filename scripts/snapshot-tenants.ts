#!/usr/bin/env npx tsx
/**
 * Génère un snapshot pré-migration des tenants prod pour le spec
 * `e2e/extended/multi-tenant-data-integrity.spec.ts`.
 *
 * Sortie : JSON sur stdout. Usage :
 *   SUPABASE_DB_URL=... DATABASE_URL=... \
 *     npx tsx scripts/snapshot-tenants.ts > e2e/fixtures/tenants-prod.json
 *
 * Ne contient PAS les passwords (on les ajoute à la main pour les comptes
 * de test ; les vrais clients restent skipped).
 *
 * Filtre : exclut les tenants dont l'email contient `e2e-`.
 */

import { Client as PgClient } from "pg";

const SUPABASE_URL = process.env.SUPABASE_DB_URL;
const PROSPECTION_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !PROSPECTION_URL) {
  console.error("FATAL: SUPABASE_DB_URL et DATABASE_URL requis");
  process.exit(1);
}

type TenantInfo = {
  email: string;
  password?: string;
  tenantSlug: string;
  tenantName: string;
  expectedProspectsAtLeast?: number;
  expectedPipelineCardsAtLeast?: number;
  isAdmin?: boolean;
  notes?: string;
};

async function main() {
  const supa = new PgClient({ connectionString: SUPABASE_URL });
  const prosp = new PgClient({ connectionString: PROSPECTION_URL });
  await supa.connect();
  await prosp.connect();

  try {
    // 1. Liste tenants + email owner depuis Supabase
    const tenants = await supa.query<{
      id: string;
      user_id: string;
      slug: string;
      name: string;
      email: string;
    }>(`
      SELECT t.id, t.user_id, t.slug, t.name, u.email
      FROM public.tenants t
      JOIN auth.users u ON u.id = t.user_id
      WHERE t.deleted_at IS NULL
        AND t.slug NOT LIKE 'e2e%'
        AND u.email NOT LIKE 'e2e-%@yopmail.com'
        AND u.email NOT LIKE 'e2e-browser-%@yopmail.com'
      ORDER BY t.created_at ASC;
    `);

    const out: TenantInfo[] = [];

    for (const t of tenants.rows) {
      // Counts depuis la DB Prospection
      const [outreach, pipeline] = await Promise.all([
        prosp.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM outreach WHERE tenant_id = $1`,
          [t.id],
        ),
        prosp.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM outreach WHERE tenant_id = $1 AND status IS NOT NULL`,
          [t.id],
        ),
      ]);

      out.push({
        email: t.email,
        tenantSlug: t.slug,
        tenantName: t.name,
        expectedProspectsAtLeast: parseInt(outreach.rows[0]?.c ?? "0", 10),
        expectedPipelineCardsAtLeast: parseInt(pipeline.rows[0]?.c ?? "0", 10),
        isAdmin: true, // owner = admin par défaut
        notes: "owner du tenant",
      });
    }

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await supa.end();
    await prosp.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
