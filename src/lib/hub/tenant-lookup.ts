/**
 * Résolution tolérante de `tenant_id` venant du Hub.
 *
 * Contexte : `POST /api/tenants/provision` retourne historiquement
 * `tenant_id: <owner_email>` (cf src/app/api/tenants/provision/route.ts).
 * Le Hub a donc pu mémoriser des `tenant_id` qui sont en réalité des
 * emails owner, pas l'UUID local Prisma.
 *
 * Les nouvelles routes T3 tenant-level (sync-member, remove-member,
 * restore-member, freeze-members, unfreeze-members) doivent accepter les
 * deux formats pour rester compatibles avec le Hub legacy sans coordination.
 * Cf todo/2026-05-21-tenant-id-accept-email-or-uuid.md (décision Robert
 * Option B, 2026-05-21).
 *
 * Règle :
 *  - format UUID v1-v8 → lookup `tenants.id`
 *  - sinon (interprété email) → lookup `users.email` puis `tenants.userId`
 *  - aucun match → null
 *
 * Tous les callers DOIVENT utiliser `tenant.id` (UUID local) en interne
 * après résolution, JAMAIS le `tenantId` brut de l'URL (qui peut être
 * l'email).
 */
import { prisma } from "@/lib/prisma";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedTenant = { id: string; userId: string };

export async function resolveTenantByIdOrEmail(
  idOrEmail: string,
): Promise<ResolvedTenant | null> {
  if (UUID_RE.test(idOrEmail)) {
    return prisma.tenant.findUnique({
      where: { id: idOrEmail },
      select: { id: true, userId: true },
    });
  }

  // Sinon = email owner (le contrat Hub legacy peut envoyer un email).
  // On résout via users.email → tenants.userId. Si plusieurs tenants pour
  // ce user (cas pathologique), on prend le plus ancien (createdAt ASC)
  // pour rester déterministe.
  const user = await prisma.user.findUnique({
    where: { email: idOrEmail },
    select: { id: true },
  });
  if (!user) return null;

  return prisma.tenant.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, userId: true },
  });
}
