import { NextRequest, NextResponse } from "next/server";
import { getPipelineLeads, getPipelineColumnOrder, savePipelineColumnOrder, reorderPipelineCards, batchReorderPipelineCards } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter, userFilter } = await getWorkspaceScope();
  const pipeline = await getPipelineLeads(tenantId, filter, userFilter);
  const columnOrder = await getPipelineColumnOrder(tenantId);
  return NextResponse.json({ pipeline, columnOrder }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter } = await getWorkspaceScope();

  try {
    const body = await request.json();

    // Save column order
    if (body.columnOrder) {
      await savePipelineColumnOrder(body.columnOrder, tenantId);
    }

    // Batch reorder (multiple columns in one atomic transaction)
    if (body.batchReorder && Array.isArray(body.columns)) {
      await batchReorderPipelineCards(body.columns, tenantId, filter);
    }
    // Single column reorder (backwards compat)
    else if (body.reorder && body.status && body.domains) {
      await reorderPipelineCards(body.status, body.domains, tenantId, filter);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Pipeline PUT error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
