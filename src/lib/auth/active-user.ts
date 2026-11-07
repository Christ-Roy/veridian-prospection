/**
 * Compte actif derrière une session (CONTRAT-HUB §3.8).
 *
 * Les sessions sont des JWT de 90 jours : sans ce contrôle, supprimer un compte au
 * Hub ne couperait aucune session déjà émise, et un email changé resterait figé
 * dans le jeton. Cache court pour le hot path, invalidé par `/api/hub/users/sync`.
 */
import { prisma } from "@/lib/prisma";

const CACHE_TTL_MS = 60_000;

type ActiveUser = { email: string; name: string | null };

const cache = new Map<string, { user: ActiveUser | null; expiresAt: number }>();

export async function getActiveUser(userId: string): Promise<ActiveUser | null> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const row = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true, name: true },
  });
  cache.set(userId, { user: row, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}

export function invalidateActiveUser(userId: string) {
  cache.delete(userId);
}

/**
 * Applique le compte actif à une session Auth.js. Sans `user`, `requireAuth` et
 * `getUserContext` répondent 401. Base injoignable : on laisse passer (§1.4), les
 * routes échoueront d'elles-mêmes sur la même base.
 */
export async function applyActiveUser<
  S extends { user?: { id?: string; email?: string | null; name?: string | null } },
>(session: S, uid: string): Promise<S> {
  let user: ActiveUser | null;
  try {
    user = await getActiveUser(uid);
  } catch (err) {
    console.warn(`[auth/active-user] lookup failed: ${(err as Error).message}`);
    if (session.user) session.user.id = uid;
    return session;
  }
  if (!user) {
    delete session.user;
    return session;
  }
  if (session.user) {
    session.user.id = uid;
    session.user.email = user.email;
    session.user.name = user.name;
  }
  return session;
}
