import type { Prisma } from "@prisma/client";

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
 *   4. Match par email + `hub_user_id` d'une AUTRE identité → refus `ConflitIdentite("hub_user_conflict")`
 *   5. Pas de match → création avec `hub_user_id` rempli
 *
 * §3.8 : relier un compte existant sans lien par son adresse exige une adresse prouvée (`emailProven: true`),
 * sinon refus `ConflitIdentite("email_not_proven")`. Par défaut, l'adresse n'est PAS prouvée.
 * La fonction refuse elle-même : un drapeau rendu à l'appelant était ignoré par trois routes sur quatre (26/11),
 * qui rattachaient alors le compte d'une autre personne et rendaient son lien de connexion.
 */
export class ConflitIdentite extends Error {
  constructor(readonly code: "hub_user_conflict" | "email_not_proven") {
    super(code);
    this.name = "ConflitIdentite";
  }
}

/** Réponse 409 d'une route du Hub pour un refus d'identité, sinon null. */
export function refusIdentite(e: unknown): Response | null {
  return e instanceof ConflitIdentite ? Response.json({ error: e.code }, { status: 409 }) : null;
}

export async function resolveOrCreateUserFromHub(params: {
  hubUserId: string;
  email: string;
  emailProven?: boolean;
}, db: Pick<Prisma.TransactionClient, "user"> = prisma): Promise<{
  id: string;
  createdByHub: boolean;
}> {
  const { hubUserId, email, emailProven = false } = params;

  const byHubId = await db.user.findUnique({
    where: { hubUserId },
    select: { id: true },
  });
  if (byHubId) {
    return { id: byHubId.id, createdByHub: false };
  }

  const byLegacyId = await db.user.findUnique({
    where: { id: hubUserId },
    select: { id: true, hubUserId: true },
  });
  if (byLegacyId) {
    if (byLegacyId.hubUserId && byLegacyId.hubUserId !== hubUserId) throw new ConflitIdentite("hub_user_conflict");
    if (!byLegacyId.hubUserId) {
      await db.user.update({
        where: { id: byLegacyId.id },
        data: { hubUserId },
      });
    }
    return { id: byLegacyId.id, createdByHub: false };
  }

  const byEmail = await db.user.findUnique({
    where: { email },
    select: { id: true, hubUserId: true },
  });
  if (byEmail) {
    if (byEmail.hubUserId) throw new ConflitIdentite("hub_user_conflict");
    if (!emailProven) throw new ConflitIdentite("email_not_proven");
    await db.user.update({
      where: { id: byEmail.id },
      data: { hubUserId },
    });
    return { id: byEmail.id, createdByHub: false };
  }

  const created = await db.user.create({
    data: {
      id: hubUserId,
      email,
      hubUserId,
      supabaseUserId: hubUserId,
    },
    select: { id: true },
  });
  return { id: created.id, createdByHub: true };
}
