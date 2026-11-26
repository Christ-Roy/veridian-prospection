/**
 * GET /api/me — current user context (lightweight version for the UI)
 *
 * Returns { userId, email, isAdmin, tenantId, workspaces: [...] } ; 403 no_workspace (workspaces: []) si la session
 * est valable mais qu'aucun espace n'est ouvert (suspendu, retiré) ; 401 sans session.
 * Used by the nav to decide whether to show the "Admin" link.
 */
import { NextResponse } from "next/server";
import { getUserContext, refusSansContexte } from "@/lib/auth/user-context";

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return refusSansContexte();
  return NextResponse.json({
    userId: ctx.userId,
    email: ctx.email,
    isAdmin: ctx.isAdmin,
    tenantId: ctx.tenantId,
    workspaces: ctx.workspaces,
    activeWorkspaceId: ctx.activeWorkspaceId,
  });
}
