import { NextRequest, NextResponse } from "next/server";
import { updateOutreach, patchOutreach } from "@/lib/queries";
import { invalidate } from "@/lib/cache";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/auth/user-context";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId: workspaceId } = await getWorkspaceScope();
  const { domain } = await params;
  // Pattern Veridian : .catch fallback objet vide, le handler accepte les
  // valeurs nullish via les `?? defaults`. Évite le 500 sur JSON malformé.
  const body = await request.json().catch(() => ({}));

  updateOutreach(domain, {
    status: body.status ?? "a_contacter",
    notes: body.notes ?? "",
    contact_method: body.contact_method ?? "",
    contacted_date: body.contacted_date ?? "",
    qualification: body.qualification ?? null,
  }, tenantId, workspaceId, auth.user.id);

  invalidate("stats");
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { domain } = await params;
  // Pattern Veridian : .catch fallback objet vide pour éviter 500 sur JSON
  // malformé. patchOutreach gère les champs absents (PATCH = update partiel).
  const body = await request.json().catch(() => ({}));

  patchOutreach(domain, body, tenantId, undefined, auth.user.id);

  invalidate("stats");
  return NextResponse.json({ ok: true });
}
