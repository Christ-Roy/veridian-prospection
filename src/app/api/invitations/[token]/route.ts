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

  // Resolve inviter email via Prisma User
  const prismaInviter = await prisma.user.findUnique({
    where: { id: invitation.invited_by },
    select: { email: true },
  });
  const inviterEmail: string | null = prismaInviter?.email ?? null;

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    workspaceId: invitation.workspace_id,
    workspaceName,
    inviterEmail,
    expiresAt: invitation.expires_at,
  });
}
