#!/usr/bin/env npx tsx
/**
 * Migration one-shot : Supabase Auth (auth.users + public.tenants)
 * → Prospection DB (User + Account(credentials) + Tenant)
 *
 * Usage :
 *   # Dry-run (recommandé en premier) :
 *   SUPABASE_DB_URL=postgresql://... DATABASE_URL=postgresql://... \
 *     npx tsx scripts/migrate-supabase-to-authjs.ts --dry-run
 *
 *   # Live :
 *   SUPABASE_DB_URL=postgresql://... DATABASE_URL=postgresql://... \
 *     npx tsx scripts/migrate-supabase-to-authjs.ts
 *
 * Idempotent : ON CONFLICT DO UPDATE pour les emails / IDs déjà migrés.
 *
 * Filtres :
 *  - Exclut les users e2e (`e2e-*@yopmail.com`, `e2e-browser-*@yopmail.com`)
 *  - Exclut les tenants soft-deleted (deleted_at IS NOT NULL)
 *
 * Préservation :
 *  - User.id = auth.users.id (UUID inchangé) → toutes les FK existantes
 *    (WorkspaceMember, Invitation, Appointment, etc.) restent valides.
 *  - Account.access_token = auth.users.encrypted_password (bcrypt $2a$10$...)
 *    → Auth.js Credentials provider peut bcrypt.compare directement.
 *  - User.email = auth.users.email
 *  - User.emailVerified = auth.users.email_confirmed_at
 *  - User.name = auth.users.raw_user_meta_data.full_name OR raw_user_meta_data.name OR null
 *  - Tenant : copie 1-pour-1 des colonnes (id, user_id, name, slug, status,
 *    twenty_*, notifuse_*, metadata, timestamps).
 *
 * Avant de run :
 *  1. Backups OK (~/backups/prospection-prod-*.sql.gz et supabase-auth-prod-*.sql.gz)
 *  2. Migration Prisma appliquée (User/Account/Tenant tables existent)
 *  3. AUCUN trafic prod (idéalement, sinon on peut casser une session active)
 */

import { Client as PgClient } from "pg";
import { PrismaClient } from "@prisma/client";

type AuthUser = {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date | null;
};

type SupaTenant = {
  id: string;
  user_id: string;
  subscription_id: string | null;
  name: string;
  slug: string;
  status: string;
  twenty_workspace_id: string | null;
  twenty_subdomain: string | null;
  twenty_api_key: string | null;
  twenty_user_email: string | null;
  twenty_user_password: string | null;
  twenty_login_token: string | null;
  twenty_login_token_created_at: Date | null;
  notifuse_workspace_slug: string | null;
  notifuse_api_key: string | null;
  notifuse_user_email: string | null;
  notifuse_invitation_sent_at: Date | null;
  metadata: Record<string, unknown> | null;
  provisioned_at: Date | null;
  last_activity_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
};

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

const SUPABASE_URL = process.env.SUPABASE_DB_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL) {
  console.error("FATAL: SUPABASE_DB_URL env var requis (ex: postgresql://postgres:...@127.0.0.1:5432/postgres)");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL env var requis (DB Prospection cible)");
  process.exit(1);
}

const E2E_EMAIL_REGEX = /^e2e[-_]/i;

function pickName(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;
  const candidates = ["full_name", "name", "display_name"];
  for (const k of candidates) {
    const v = raw[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

async function main() {
  const mode = DRY_RUN ? "DRY-RUN" : "LIVE";
  console.log(`[migrate] ${mode} — Supabase → Prospection Auth.js`);

  const supa = new PgClient({ connectionString: SUPABASE_URL });
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

  await supa.connect();

  try {
    // ========================================================================
    // 1) Lire les users non-e2e
    // ========================================================================
    const usersResult = await supa.query<AuthUser>(`
      SELECT id, email, encrypted_password, email_confirmed_at,
             raw_user_meta_data, created_at, updated_at
      FROM auth.users
      WHERE email IS NOT NULL
        AND email NOT LIKE 'e2e-%@yopmail.com'
        AND email NOT LIKE 'e2e-browser-%@yopmail.com'
        AND email NOT LIKE 'e2e_%@yopmail.com'
      ORDER BY created_at ASC;
    `);

    console.log(`[migrate] users à migrer : ${usersResult.rows.length}`);

    let userOk = 0;
    let userSkipped = 0;
    let userErr = 0;

    for (const u of usersResult.rows) {
      if (E2E_EMAIL_REGEX.test(u.email)) {
        userSkipped++;
        continue;
      }

      const name = pickName(u.raw_user_meta_data);
      const emailVerified = u.email_confirmed_at;

      if (VERBOSE) {
        console.log(`[user] ${u.email} (${u.id}) — verified=${!!emailVerified}, name=${name ?? "(null)"}`);
      }

      if (DRY_RUN) {
        userOk++;
        continue;
      }

      try {
        // upsert User
        await prisma.user.upsert({
          where: { id: u.id },
          update: {
            email: u.email,
            name,
            emailVerified,
            supabaseUserId: u.id,
            updatedAt: u.updated_at ?? new Date(),
          },
          create: {
            id: u.id,
            email: u.email,
            name,
            emailVerified,
            supabaseUserId: u.id,
            createdAt: u.created_at,
            updatedAt: u.updated_at ?? u.created_at,
          },
        });

        // upsert Account(credentials) si encrypted_password présent
        if (u.encrypted_password && u.encrypted_password.length > 0) {
          await prisma.account.upsert({
            where: {
              provider_providerAccountId: {
                provider: "credentials",
                providerAccountId: u.id,
              },
            },
            update: {
              access_token: u.encrypted_password,
            },
            create: {
              userId: u.id,
              type: "credentials",
              provider: "credentials",
              providerAccountId: u.id,
              access_token: u.encrypted_password,
            },
          });
        }

        userOk++;
      } catch (err) {
        userErr++;
        console.error(`[user] FAIL ${u.email}:`, (err as Error).message);
      }
    }

    console.log(`[migrate] users : OK=${userOk}, SKIP=${userSkipped}, ERR=${userErr}`);

    // ========================================================================
    // 2) Lire les tenants non-deleted
    // ========================================================================
    const tenantsResult = await supa.query<SupaTenant>(`
      SELECT id, user_id, subscription_id, name, slug, status::text AS status,
             twenty_workspace_id, twenty_subdomain, twenty_api_key,
             twenty_user_email, twenty_user_password,
             twenty_login_token, twenty_login_token_created_at,
             notifuse_workspace_slug, notifuse_api_key,
             notifuse_user_email, notifuse_invitation_sent_at,
             metadata, provisioned_at, last_activity_at,
             created_at, updated_at, deleted_at
      FROM public.tenants
      WHERE deleted_at IS NULL
      ORDER BY created_at ASC;
    `);

    console.log(`[migrate] tenants à migrer : ${tenantsResult.rows.length}`);

    let tenantOk = 0;
    let tenantErr = 0;

    for (const t of tenantsResult.rows) {
      if (VERBOSE) {
        console.log(`[tenant] ${t.slug} (${t.id}) — owner=${t.user_id}, status=${t.status}`);
      }

      if (DRY_RUN) {
        tenantOk++;
        continue;
      }

      try {
        // Validation : le user_id doit exister dans User (sinon FK casse)
        const ownerExists = await prisma.user.findUnique({
          where: { id: t.user_id },
          select: { id: true },
        });
        if (!ownerExists) {
          console.warn(`[tenant] SKIP ${t.slug}: owner user ${t.user_id} not migrated (probable e2e)`);
          continue;
        }

        await prisma.tenant.upsert({
          where: { id: t.id },
          update: {
            userId: t.user_id,
            subscriptionId: t.subscription_id,
            name: t.name,
            slug: t.slug,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            status: (t.status as any) ?? "pending",
            twentyWorkspaceId: t.twenty_workspace_id,
            twentySubdomain: t.twenty_subdomain,
            twentyApiKey: t.twenty_api_key,
            twentyUserEmail: t.twenty_user_email,
            twentyUserPassword: t.twenty_user_password,
            twentyLoginToken: t.twenty_login_token,
            twentyLoginTokenCreatedAt: t.twenty_login_token_created_at,
            notifuseWorkspaceSlug: t.notifuse_workspace_slug,
            notifuseApiKey: t.notifuse_api_key,
            notifuseUserEmail: t.notifuse_user_email,
            notifuseInvitationSentAt: t.notifuse_invitation_sent_at,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: (t.metadata as any) ?? null,
            provisionedAt: t.provisioned_at,
            lastActivityAt: t.last_activity_at,
            updatedAt: t.updated_at ?? new Date(),
          },
          create: {
            id: t.id,
            userId: t.user_id,
            subscriptionId: t.subscription_id,
            name: t.name,
            slug: t.slug,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            status: (t.status as any) ?? "pending",
            twentyWorkspaceId: t.twenty_workspace_id,
            twentySubdomain: t.twenty_subdomain,
            twentyApiKey: t.twenty_api_key,
            twentyUserEmail: t.twenty_user_email,
            twentyUserPassword: t.twenty_user_password,
            twentyLoginToken: t.twenty_login_token,
            twentyLoginTokenCreatedAt: t.twenty_login_token_created_at,
            notifuseWorkspaceSlug: t.notifuse_workspace_slug,
            notifuseApiKey: t.notifuse_api_key,
            notifuseUserEmail: t.notifuse_user_email,
            notifuseInvitationSentAt: t.notifuse_invitation_sent_at,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: (t.metadata as any) ?? null,
            provisionedAt: t.provisioned_at,
            lastActivityAt: t.last_activity_at,
            createdAt: t.created_at,
            updatedAt: t.updated_at ?? t.created_at,
          },
        });

        tenantOk++;
      } catch (err) {
        tenantErr++;
        console.error(`[tenant] FAIL ${t.slug}:`, (err as Error).message);
      }
    }

    console.log(`[migrate] tenants : OK=${tenantOk}, ERR=${tenantErr}`);

    // ========================================================================
    // 3) Sanity checks post-migration
    // ========================================================================
    if (!DRY_RUN) {
      const userCount = await prisma.user.count();
      const accountCount = await prisma.account.count({ where: { provider: "credentials" } });
      const tenantCount = await prisma.tenant.count();
      console.log(`[migrate] DB Prospection après migration :`);
      console.log(`  - users        : ${userCount}`);
      console.log(`  - accounts(cr) : ${accountCount}`);
      console.log(`  - tenants      : ${tenantCount}`);
    }
  } finally {
    await supa.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate] FATAL:", err);
  process.exit(1);
});
