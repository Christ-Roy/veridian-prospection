import { NextRequest, NextResponse } from "next/server";
import { updateClaudeActivity } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string; id: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter } = await getWorkspaceScope();
  const { id } = await params;
  const body = await request.json();

  const { content, title } = body;

  if (!content && !title) {
    return NextResponse.json(
      { error: "At least one of content or title is required" },
      { status: 400 }
    );
  }

  try {
    await updateClaudeActivity(parseInt(id, 10), { content, title }, tenantId, filter);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Erreur update claude_activity:", error);
    return NextResponse.json(
      { error: `Erreur: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
