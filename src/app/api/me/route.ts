/**
 * GET /api/me — current user context (lightweight version for the UI)
 *
 * Returns { userId, email, isAdmin, tenantId, workspaces: [...] } or 401.
 * Used by the nav to decide whether to show the "Admin" link.
 */
import { NextResponse } from "next/server";
import { getUserContext } from "@/lib/supabase/user-context";

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    userId: ctx.userId,
    email: ctx.email,
    isAdmin: ctx.isAdmin,
    tenantId: ctx.tenantId,
    workspaces: ctx.workspaces,
    activeWorkspaceId: ctx.activeWorkspaceId,
  });
}
