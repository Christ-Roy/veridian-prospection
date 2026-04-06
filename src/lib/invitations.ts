/**
 * Invitation flow helpers (Prospection standalone).
 *
 * Pure-ish functions consumed by `src/app/api/admin/invitations/**` and
 * `src/app/api/invitations/**`. Designed to be unit-tested with Prisma + fetch
 * mocks (see `invitations.test.ts`).
 *
 * Shape of what each function returns — used by the route handlers:
 *
 *   createInvitation  → { id, token, inviteUrl, expiresAt, emailSent }
 *   getInvitationByToken → Invitation row (snake_case) | null
 *   acceptInvitation  → { session: {access_token, refresh_token, ...}, userId, redirectTo }
 *   revokeInvitation  → void
 *   listInvitationsByTenant → Invitation[]
 *
 * Supabase admin API (auth.users create/update/list) is called via raw fetch
 * instead of the SDK, so it is trivially mockable via `vi.stubGlobal('fetch', …)`.
 */
import { randomBytes } from "crypto";
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

function getSupabaseAdminConfig(): { url: string; serviceKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function getSupabasePublicConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Create an invitation row and (best-effort) send the email via Supabase
 * admin generateLink. `emailSent` is `false` if Supabase is not configured,
 * `SUPABASE_SMTP_CONFIGURED=false`, or generateLink throws.
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

  // Best-effort email: Supabase admin generateLink (type:invite).
  let emailSent = false;
  if (process.env.SUPABASE_SMTP_CONFIGURED !== "false") {
    const cfg = getSupabaseAdminConfig();
    if (cfg) {
      try {
        const res = await fetch(`${cfg.url}/auth/v1/admin/generate_link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: cfg.serviceKey,
            Authorization: `Bearer ${cfg.serviceKey}`,
          },
          body: JSON.stringify({
            type: "invite",
            email,
            options: { redirect_to: inviteUrl },
          }),
        });
        emailSent = res.ok;
        if (!res.ok) {
          console.warn(
            `[invitations] generateLink failed (${res.status}): ${await res.text().catch(() => "")}`,
          );
        }
      } catch (err) {
        console.warn(`[invitations] generateLink threw:`, err);
        emailSent = false;
      }
    }
  }

  return { id, token, inviteUrl, expiresAt, emailSent };
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
  session: {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in?: number;
  };
  userId: string;
  redirectTo: string;
}

/**
 * Accept an invitation: ensure a Supabase user exists (create or update
 * password), upsert workspace membership, upsert tenant mapping, sign the user
 * in and mark the invitation accepted.
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

  const adminCfg = getSupabaseAdminConfig();
  const publicCfg = getSupabasePublicConfig();
  if (!adminCfg || !publicCfg) {
    throw new Error("Supabase is not configured on this environment");
  }
  const adminHeaders = {
    "Content-Type": "application/json",
    apikey: adminCfg.serviceKey,
    Authorization: `Bearer ${adminCfg.serviceKey}`,
  };

  // 1) Look up existing user by email
  const listRes = await fetch(
    `${adminCfg.url}/auth/v1/admin/users?email=${encodeURIComponent(invitation.email)}`,
    { method: "GET", headers: adminHeaders },
  );
  if (!listRes.ok) {
    throw new Error(`Supabase admin list users failed: ${listRes.status}`);
  }
  const listData = (await listRes.json()) as { users?: Array<{ id: string; email?: string }> };
  const existing = (listData.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === invitation.email,
  );

  let userId: string;
  if (existing) {
    // 2a) Update password for the existing user
    const updRes = await fetch(`${adminCfg.url}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        password: input.password,
        email_confirm: true,
        user_metadata: input.fullName ? { full_name: input.fullName } : undefined,
      }),
    });
    if (!updRes.ok) {
      throw new Error(`Supabase admin update user failed: ${updRes.status}`);
    }
    userId = existing.id;
  } else {
    // 2b) Create the user with email_confirm:true
    const createRes = await fetch(`${adminCfg.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: invitation.email,
        password: input.password,
        email_confirm: true,
        user_metadata: input.fullName ? { full_name: input.fullName } : {},
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Supabase admin create user failed: ${createRes.status}`);
    }
    const created = (await createRes.json()) as { id?: string; user?: { id: string } };
    userId = created.id ?? created.user?.id ?? "";
    if (!userId) throw new Error("Supabase admin create user returned no id");
  }

  // 3) Upsert workspace_members if a workspace is targeted
  if (invitation.workspace_id) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES ($1::uuid, $2::uuid, $3, now())
      ON CONFLICT (workspace_id, user_id)
      DO UPDATE SET role = EXCLUDED.role
      `,
      invitation.workspace_id,
      userId,
      invitation.role,
    );
  }

  // 4) Upsert tenant mapping in Supabase public.tenants (best-effort).
  //    Prospection doesn't own `tenants`; the hub does. We insert a row if
  //    none exists for this user so the user can resolve to a tenant on next
  //    login. Failure is logged but not fatal — the invite flow should still
  //    succeed (the hub can reconcile later).
  try {
    const tenantRes = await fetch(
      `${adminCfg.url}/rest/v1/tenants?user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { method: "GET", headers: adminHeaders },
    );
    if (tenantRes.ok) {
      const existingTenants = (await tenantRes.json()) as Array<{ id: string }>;
      if (existingTenants.length === 0) {
        await fetch(`${adminCfg.url}/rest/v1/tenants`, {
          method: "POST",
          headers: { ...adminHeaders, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ id: invitation.tenant_id, user_id: userId }),
        });
      }
    }
  } catch (err) {
    console.warn(`[invitations] tenant upsert skipped:`, err);
  }

  // 5) Sign in with the chosen password to produce a session
  const signInRes = await fetch(`${publicCfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: publicCfg.anonKey,
    },
    body: JSON.stringify({ email: invitation.email, password: input.password }),
  });
  if (!signInRes.ok) {
    throw new Error(`Supabase signin failed: ${signInRes.status}`);
  }
  const session = (await signInRes.json()) as AcceptInvitationResult["session"];

  // 6) Mark invitation accepted
  await prisma.$executeRawUnsafe(
    `UPDATE invitations SET accepted_at = now() WHERE id = $1`,
    invitation.id,
  );

  return { session, userId, redirectTo: "/prospects" };
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
