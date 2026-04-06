import { NextRequest, NextResponse } from "next/server";
import { updateFollowup } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter } = await getWorkspaceScope();
  const { id } = await params;
  const body = await request.json();

  const { status, note } = body;

  if (!status && !note) {
    return NextResponse.json(
      { error: "At least one of status or note is required" },
      { status: 400 }
    );
  }

  if (status && !["pending", "done", "cancelled"].includes(status)) {
    return NextResponse.json(
      { error: 'status must be one of: pending, done, cancelled' },
      { status: 400 }
    );
  }

  try {
    await updateFollowup(parseInt(id, 10), { status, note }, tenantId, filter);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Erreur update followup:", error);
    return NextResponse.json(
      { error: `Erreur: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
