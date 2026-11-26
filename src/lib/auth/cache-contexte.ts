/** Cache des contextes utilisateur (3 s, CACHE_TTL_MS de user-context), à part pour qu'une route du Hub l'oublie sans charger l'authentification. */
import type { UserContext } from "./user-context";

/** Clé : `userId`, ou `userId:espace` quand un espace est choisi. */
export const contextCache = new Map<string, { ctx: UserContext; expiresAt: number }>();

export function invalidateUserContext(userId: string) {
  for (const cle of contextCache.keys()) if (cle === userId || cle.startsWith(`${userId}:`)) contextCache.delete(cle);
}

export function invalidateAllUserContexts() {
  contextCache.clear();
}
