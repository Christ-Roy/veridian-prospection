/**
 * Admin API — Invitations (invite flow).
 *
 * GET  /api/admin/invitations?status=pending|accepted|revoked|expired|all
 *      → { invitations: InvitationRow[] }
 *
 * POST /api/admin/invitations
 *      body: { email: string, workspaceId?: string, role?: 'admin'|'member' }
 *      → 201 {
 *          id: number,
 *          token: string,
 *          inviteUrl: string,
 *          expiresAt: string (ISO),
 *          emailSent: boolean,
 *          email: string,
 *          workspaceId: string | null,
 *          role: 'admin'|'member'
 *        }
 *
 * Auth: requireAdmin (tenant owner or workspace admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/user-context";
import { prisma } from "@/lib/prisma";
import {
  createInvitation,
  listInvitationsByTenant,
  type InvitationStatus,
} from "@/lib/invitations";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const status = (request.nextUrl.searchParams.get("status") || "pending") as InvitationStatus;
  const invitations = await listInvitationsByTenant(auth.ctx.tenantId, { status });
  return NextResponse.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      workspaceId: inv.workspace_id,
      token: inv.token,
      expiresAt: inv.expires_at,
      acceptedAt: inv.accepted_at,
      revokedAt: inv.revoked_at,
      createdAt: inv.created_at,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const email: string = (body?.email || "").trim().toLowerCase();
  const workspaceId: string | null = body?.workspaceId ?? null;
  const role: "admin" | "member" = body?.role === "admin" ? "admin" : "member";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "valid email is required" }, { status: 400 });
  }

  // If a workspaceId is given, ensure it belongs to this tenant
  if (workspaceId) {
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId, tenantId: auth.ctx.tenantId },
      select: { id: true },
    });
    if (!ws) {
      return NextResponse.json({ error: "workspace not found" }, { status: 404 });
    }
  }

  try {
    const result = await createInvitation({
      email,
      invitedBy: auth.ctx.userId,
      tenantId: auth.ctx.tenantId,
      workspaceId,
      role,
    });
    return NextResponse.json(
      {
        id: result.id,
        token: result.token,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt.toISOString(),
        emailSent: result.emailSent,
        email,
        workspaceId,
        role,
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed to create invitation";
    console.error("[POST /api/admin/invitations] error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
