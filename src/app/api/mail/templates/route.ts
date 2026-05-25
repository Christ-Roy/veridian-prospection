/**
 * GET /api/mail/templates — liste templates dispo pour le tenant courant.
 *
 * Concaténation customs (tenant_mail_templates non soft-deleted) + fallbacks
 * hardcodés. Auth user simple (n'importe quel rôle), pas admin — c'est la
 * source pour le dropdown compose dans la modale "Envoyer un mail".
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { listTenantTemplates } from "@/lib/mail/tenant-templates";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const templates = await listTenantTemplates(tenantId);
  return NextResponse.json({ templates });
}
