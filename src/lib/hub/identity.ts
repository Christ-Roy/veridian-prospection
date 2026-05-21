import { prisma } from "@/lib/prisma";

/**
 * Résout (ou crée) un user Prospection à partir de l'identité Hub.
 *
 * CONTRAT-HUB v1.5 §3.7 :
 *  - `hub_app.users.id` = source de vérité humaine
 *  - `users.id` Prospection = PK locale, INCHANGÉE
 *  - `users.hub_user_id` = colonne nullable UNIQUE, backfillée au premier
 *    contact Hub (provision, attach-owner, attach-member, sync-member,
 *    update-plan).
 *
 * Ordre de résolution :
 *   1. Match par `hub_user_id` → renvoie cet user (cas nominal post-backfill)
 *   2. Rétrocompat legacy : `users.id` == `hubUserId` (pattern historique
 *      où le upsert by id utilisait directement le UUID Hub comme PK locale)
 *      → backfille `hub_user_id` sur cette row
 *   3. Match par email + `hub_user_id` NULL → backfill OK
 *   4. Match par email + `hub_user_id` déjà rempli (différent) → préfère le
 *      local, ne touche pas (cas pathologique : 2 identités Hub pour 1 email
 *      local — laisser le supérieur trancher)
 *   5. Pas de match → création avec `hub_user_id` rempli
 */
export async function resolveOrCreateUserFromHub(params: {
  hubUserId: string;
  email: string;
}): Promise<{ id: string; createdByHub: boolean; hubUserIdConflict: boolean }> {
  const { hubUserId, email } = params;

  const byHubId = await prisma.user.findUnique({
    where: { hubUserId },
    select: { id: true },
  });
  if (byHubId) {
    return { id: byHubId.id, createdByHub: false, hubUserIdConflict: false };
  }

  const byLegacyId = await prisma.user.findUnique({
    where: { id: hubUserId },
    select: { id: true, hubUserId: true },
  });
  if (byLegacyId) {
    if (!byLegacyId.hubUserId) {
      await prisma.user.update({
        where: { id: byLegacyId.id },
        data: { hubUserId },
      });
    }
    return { id: byLegacyId.id, createdByHub: false, hubUserIdConflict: false };
  }

  const byEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, hubUserId: true },
  });
  if (byEmail) {
    if (!byEmail.hubUserId) {
      await prisma.user.update({
        where: { id: byEmail.id },
        data: { hubUserId },
      });
      return {
        id: byEmail.id,
        createdByHub: false,
        hubUserIdConflict: false,
      };
    }
    if (byEmail.hubUserId === hubUserId) {
      return {
        id: byEmail.id,
        createdByHub: false,
        hubUserIdConflict: false,
      };
    }
    return { id: byEmail.id, createdByHub: false, hubUserIdConflict: true };
  }

  const created = await prisma.user.create({
    data: {
      id: hubUserId,
      email,
      hubUserId,
      supabaseUserId: hubUserId,
    },
    select: { id: true },
  });
  return { id: created.id, createdByHub: true, hubUserIdConflict: false };
}
