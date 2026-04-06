/**
 * Admin API — Revoke a single invitation.
 *
 * DELETE /api/admin/invitations/[id]  → 204 (idempotent)
 * Auth: requireAdmin (tenant-scoped — can only revoke your own tenant's rows).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/user-context";
import { revokeInvitation } from "@/lib/invitations";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id: idRaw } = await params;
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await revokeInvitation(id, auth.ctx.tenantId);
  return new NextResponse(null, { status: 204 });
}
