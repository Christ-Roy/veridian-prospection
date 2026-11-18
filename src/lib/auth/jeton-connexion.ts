/**
 * Lien de connexion à usage unique, lié à UN utilisateur (table sso_login_tokens, jeton haché en SHA-256).
 * `/api/auth/token` ouvre la session de cet utilisateur et de lui seul.
 *
 * Remplace, pour un membre invité, l'ancien jeton posé sur le tenant : celui-là ouvrait toujours la session du
 * PROPRIÉTAIRE (audit du 11/07, C1, corrigé le 18/11) ; un membre qui cliquait son lien devenait propriétaire.
 */
import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

export async function emettreJetonConnexion(userId: string, dureeMs: number): Promise<{ jeton: string; expire: Date }> {
  const jeton = randomBytes(32).toString("hex");
  const expire = new Date(Date.now() + dureeMs);
  await prisma.ssoLoginToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await prisma.ssoLoginToken.create({ data: { tokenHash: createHash("sha256").update(jeton).digest("hex"), userId, expiresAt: expire } });
  return { jeton, expire };
}
