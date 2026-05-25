/**
 * DELETE /api/integrations/openrouter/disconnect
 *
 * Soft-delete le link OpenRouter du user actuel. La résolution adapter
 * retombera automatiquement sur la config tenant (si elle existe) ou
 * sur la clé Veridian globale (fallback gratuit).
 *
 * Idempotent : si pas de link → 204 quand même.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { logAudit } from "@/lib/audit";
import { getTenantId } from "@/lib/auth/tenant";
import { disconnectOpenRouterLink } from "@/lib/openrouter/queries";

export async function DELETE() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  await disconnectOpenRouterLink(auth.user.id);

  const tenantId = await getTenantId(auth.user.id);
  if (tenantId) {
    void logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.user.id,
      action: "openrouter.disconnected",
      targetType: "user",
      targetId: auth.user.id,
    });
  }

  return new NextResponse(null, { status: 204 });
}
