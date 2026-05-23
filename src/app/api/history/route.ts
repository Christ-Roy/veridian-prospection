import { NextRequest, NextResponse } from "next/server";
import { getHistoryLeads } from "@/lib/queries";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { getUserContext } from "@/lib/auth/user-context";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const ctx = await getUserContext();

  // /historique = MES consultations (anti désync cross-membre).
  // Admin avec ?showAll=1 voit tout le tenant (futur dashboard KPI).
  const showAll = ctx?.isAdmin && request.nextUrl.searchParams.get("showAll") === "1";
  const userId = showAll ? null : auth.user.id;

  const leads = await getHistoryLeads(200, tenantId, userId);
  // no-store : un commercial qui passe d'un lead en négo dans le kanban à
  // /historique doit voir le statut à jour immédiatement, sans dépendre du
  // cache navigateur (HTTP heuristic peut tenir des minutes sans Cache-Control).
  return NextResponse.json(leads, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}
