/**
 * Helper freeze cross-app — CONTRAT-HUB v1.5 §5.21.
 *
 * Un user est "frozen" sur un tenant si AU MOINS UN de ses workspace_members
 * (non soft-deleted) du tenant a `frozen_at != NULL`.
 *
 * Côté Prospection v1.5 on freeze TOUS les workspace_members du user pour
 * le tenant en une opération atomique (cf freeze-members route) — la requête
 * EXISTS sur n'importe quelle row freezed suffit donc à détecter l'état.
 *
 * Side-effects côté UI/API quand frozen :
 *  - GET /api/leads/[domain] obfusque les SENSITIVE_FIELDS
 *  - GET /api/prospects obfusque (à brancher progressivement, §5.9)
 *  - Écritures peuvent retourner 402 (à câbler quand on outille les write paths)
 */
import { prisma } from "@/lib/prisma";

/**
 * Retourne `true` si le user est freezed sur au moins un workspace du tenant.
 * Idempotent, safe à appeler sur chaque request (la requête est indexée).
 *
 * Le tenantId est résolu en amont via `getTenantId(userId)` — caller fournit
 * les deux pour éviter une lookup redondant.
 */
export async function isUserFrozen(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const found = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      deletedAt: null,
      frozenAt: { not: null },
      workspace: { tenantId, deletedAt: null },
    },
    select: { workspaceId: true },
  });
  return Boolean(found);
}
