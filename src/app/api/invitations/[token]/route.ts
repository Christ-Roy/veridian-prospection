/**
 * Public API — Invitation lookup (landing page prep).
 *
 * GET /api/invitations/[token]
 *   → 200 {
 *       email: string,
 *       role: 'admin'|'member',
 *       workspaceId: string | null,
 *       workspaceName: string | null,
 *       inviterEmail: string | null,
 *       expiresAt: string (ISO)
 *     }
 *   → 404 { error } if the token is missing, already accepted, revoked or expired.
 *
 * No auth required — the token itself is the credential.
 */
import { NextResponse } from "next/server";
import { getInvitationByToken } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseAdmin(url, key);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    return NextResponse.json({ error: "invitation invalid or expired" }, { status: 404 });
  }

  // Resolve workspace name (optional)
  let workspaceName: string | null = null;
  if (invitation.workspace_id) {
    const ws = await prisma.workspace.findUnique({
      where: { id: invitation.workspace_id },
      select: { name: true },
    });
    workspaceName = ws?.name ?? null;
  }

  // Resolve inviter email via Supabase admin (best-effort)
  let inviterEmail: string | null = null;
  const admin = getAdminClient();
  if (admin) {
    try {
      const { data } = await admin.auth.admin.getUserById(invitation.invited_by);
      inviterEmail = data?.user?.email ?? null;
    } catch {
      inviterEmail = null;
    }
  }

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    workspaceId: invitation.workspace_id,
    workspaceName,
    inviterEmail,
    expiresAt: invitation.expires_at,
  });
}
