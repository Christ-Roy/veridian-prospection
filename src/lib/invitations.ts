/**
 * Invitation flow helpers (Prospection standalone, Auth.js v5).
 *
 * Migré 2026-05-23 : Supabase Auth (gotrue) → Prisma + Auth.js v5 credentials
 * (bcrypt). L'ancien flow appelait /auth/v1/admin/* de Supabase, mort depuis
 * la migration Auth.js. Le helper crée maintenant User + Account(credentials)
 * + WorkspaceMember directement en Prisma. Le client appelle ensuite
 * signIn("credentials") côté front pour ouvrir la session Auth.js.
 *
 * Shape of what each function returns — used by the route handlers:
 *
 *   createInvitation  → { id, token, inviteUrl, expiresAt, emailSent }
 *   getInvitationByToken → Invitation row (snake_case) | null
 *   acceptInvitation  → { userId, email, redirectTo }
 *   revokeInvitation  → void
 *   listInvitationsByTenant → Invitation[]
 */
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired" | "all";

export interface InvitationRow {
  id: number;
  email: string;
  invited_by: string;
  tenant_id: string;
  workspace_id: string | null;
  role: "admin" | "member";
  token: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface CreateInvitationInput {
  email: string;
  invitedBy: string; // auth.users.id (UUID)
  tenantId: string;
  workspaceId?: string | null;
  role?: "admin" | "member";
}

export interface CreateInvitationResult {
  id: number;
  token: string;
  inviteUrl: string;
  expiresAt: Date;
  emailSent: boolean;
}

/** Base URL used for invite links. APP_URL > NEXT_PUBLIC_SITE_URL > hard fallback. */
function getInviteBaseUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000"
  );
}

/**
 * Create an invitation row. Le lien d'invitation est dans `inviteUrl` —
 * l'admin doit aujourd'hui copier-coller manuellement, on n'envoie plus le
 * mail via Supabase (GoTrue mort). TODO : brancher Notifuse pour automatiser
 * l'envoi du mail d'invitation (cf todo/2026-05-23-invitations-notifuse-email.md).
 *
 * `emailSent` reste dans le retour pour ne pas casser le contrat API, mais
 * vaut toujours `false` tant que Notifuse n'est pas branché.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("invalid email");
  }
  const role: "admin" | "member" = input.role === "admin" ? "admin" : "member";
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `
    INSERT INTO invitations (email, invited_by, tenant_id, workspace_id, role, token, expires_at)
    VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)
    RETURNING id
    `,
    email,
    input.invitedBy,
    input.tenantId,
    input.workspaceId ?? null,
    role,
    token,
    expiresAt,
  );
  const id = rows[0]?.id;
  if (typeof id !== "number") {
    throw new Error("failed to insert invitation");
  }

  const inviteUrl = `${getInviteBaseUrl()}/invite/${token}`;

  return { id, token, inviteUrl, expiresAt, emailSent: false };
}

/**
 * Look up an invitation by token. Returns `null` if not found, already
 * accepted, revoked, or expired.
 */
export async function getInvitationByToken(token: string): Promise<InvitationRow | null> {
  if (!token) return null;
  const rows = await prisma.$queryRawUnsafe<InvitationRow[]>(
    `
    SELECT id, email, invited_by, tenant_id, workspace_id, role, token,
           expires_at, accepted_at, revoked_at, created_at
    FROM invitations
    WHERE token = $1
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1
    `,
    token,
  );
  return rows[0] ?? null;
}

export interface AcceptInvitationInput {
  token: string;
  password: string;
  fullName?: string;
}

export interface AcceptInvitationResult {
  userId: string;
  email: string;
  redirectTo: string;
}

/**
 * Accept an invitation : crée le User + Account(credentials, bcrypt) si
 * absent, upsert le WorkspaceMember, marque l'invitation accepted. Le client
 * ouvre ensuite la session Auth.js via signIn("credentials").
 *
 * Migration 2026-05-23 (Supabase → Auth.js v5) :
 * - L'ancien flow appelait /auth/v1/admin/users (GoTrue, mort) pour
 *   create/update user + signin password — tout ça est remplacé par Prisma.
 * - Pattern aligné sur ensureCanonicalUser() du helper E2E
 *   (e2e/helpers/auth.ts) et sur le provider Credentials de src/lib/auth.ts.
 * - Account.access_token stocke le bcrypt du password (clé unique
 *   provider+providerAccountId=email).
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const invitation = await getInvitationByToken(input.token);
  if (!invitation) {
    throw new Error("invitation invalid or expired");
  }
  if (!input.password || input.password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }

  const email = invitation.email.toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 10);

  // 1) User — upsert par email (clé unique). Si existe déjà (pré-créé par
  //    le Hub via provision ou par un autre flow), on garde son id et on
  //    rafraîchit le nom si fourni.
  const user = await prisma.user.upsert({
    where: { email },
    update: input.fullName ? { name: input.fullName, deletedAt: null } : { deletedAt: null },
    create: {
      email,
      name: input.fullName ?? null,
      emailVerified: new Date(),
    },
    select: { id: true },
  });

  // 2) Account credentials — upsert sur la clé unique (provider,
  //    providerAccountId). On utilise l'email comme providerAccountId
  //    (stable, unique, aligné avec le pattern E2E + login form).
  //    access_token = bcrypt hash du password (consommé par le provider
  //    Credentials de src/lib/auth.ts → bcrypt.compare).
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "credentials",
        providerAccountId: email,
      },
    },
    update: { userId: user.id, access_token: passwordHash },
    create: {
      userId: user.id,
      type: "credentials",
      provider: "credentials",
      providerAccountId: email,
      access_token: passwordHash,
    },
  });

  // 3) WorkspaceMember — si l'invitation cible un workspace, upsert le
  //    membership avec le rôle prévu. Sinon (invitation tenant-level
  //    legacy), on skippe.
  if (invitation.workspace_id) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES ($1::uuid, $2::uuid, $3, now())
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
      `,
      invitation.workspace_id,
      user.id,
      invitation.role,
    );
  }

  // 4) Marquer l'invitation acceptée (one-shot).
  await prisma.$executeRawUnsafe(
    `UPDATE invitations SET accepted_at = now() WHERE id = $1`,
    invitation.id,
  );

  return { userId: user.id, email, redirectTo: "/prospects" };
}

/**
 * Revoke a pending invitation. Only the tenant that owns the invitation can
 * revoke it. Silently no-ops if the row is missing or already revoked.
 */
export async function revokeInvitation(id: number, tenantId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    UPDATE invitations
       SET revoked_at = now()
     WHERE id = $1
       AND tenant_id = $2::uuid
       AND revoked_at IS NULL
       AND accepted_at IS NULL
    `,
    id,
    tenantId,
  );
}

/**
 * List invitations for a tenant, filtered by status.
 *   pending  → not accepted, not revoked, not expired
 *   accepted → accepted_at IS NOT NULL
 *   revoked  → revoked_at IS NOT NULL
 *   expired  → expires_at <= now() AND accepted_at IS NULL AND revoked_at IS NULL
 *   all      → everything
 */
export async function listInvitationsByTenant(
  tenantId: string,
  opts: { status?: InvitationStatus } = {},
): Promise<InvitationRow[]> {
  const status = opts.status ?? "pending";
  let whereExtra = "";
  switch (status) {
    case "pending":
      whereExtra = "AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()";
      break;
    case "accepted":
      whereExtra = "AND accepted_at IS NOT NULL";
      break;
    case "revoked":
      whereExtra = "AND revoked_at IS NOT NULL";
      break;
    case "expired":
      whereExtra = "AND expires_at <= now() AND accepted_at IS NULL AND revoked_at IS NULL";
      break;
    case "all":
      whereExtra = "";
      break;
  }

  const rows = await prisma.$queryRawUnsafe<InvitationRow[]>(
    `
    SELECT id, email, invited_by, tenant_id, workspace_id, role, token,
           expires_at, accepted_at, revoked_at, created_at
    FROM invitations
    WHERE tenant_id = $1::uuid
    ${whereExtra}
    ORDER BY created_at DESC
    LIMIT 500
    `,
    tenantId,
  );
  return rows;
}
