/**
 * Queries DB pour le link OpenRouter par user (OAuth PKCE).
 *
 * Sépare la vue "client safe" (clé masquée, juste l'email pour affichage)
 * de la vue interne (avec api_key_enc, consommée par resolveAdapter).
 */
import { prisma } from "@/lib/prisma";
import { encryptPassword } from "@/lib/crypto/encrypt-password";

export interface UserOpenRouterLinkPublic {
  connected: boolean;
  openrouterEmail: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
}

export interface UserOpenRouterLinkInternal {
  id: string;
  userId: string;
  apiKeyEnc: string;
  openrouterEmail: string | null;
}

/** Vue publique — clé API JAMAIS exposée. Renvoie l'état pour la UI. */
export async function getOpenRouterLinkPublic(
  userId: string,
): Promise<UserOpenRouterLinkPublic> {
  const row = await prisma.userOpenRouterLink.findUnique({ where: { userId } });
  if (!row || row.deletedAt) {
    return { connected: false, openrouterEmail: null, connectedAt: null, lastUsedAt: null };
  }
  return {
    connected: true,
    openrouterEmail: row.openrouterEmail,
    connectedAt: row.connectedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** Vue interne — appelé par resolveAdapter() uniquement. */
export async function getOpenRouterLinkInternal(
  userId: string,
): Promise<UserOpenRouterLinkInternal | null> {
  const row = await prisma.userOpenRouterLink.findUnique({ where: { userId } });
  if (!row || row.deletedAt || !row.apiKeyEnc) return null;
  return {
    id: row.id,
    userId: row.userId,
    apiKeyEnc: row.apiKeyEnc,
    openrouterEmail: row.openrouterEmail,
  };
}

/**
 * Upsert le link après échange OAuth PKCE réussi. Chiffre la clé à la volée.
 * Si un link existe déjà (même user a reconnecté) : écrase la clé précédente
 * et réinitialise deletedAt à null (revocation implicite).
 */
export async function upsertOpenRouterLink(params: {
  userId: string;
  apiKey: string;
  openrouterEmail?: string | null;
  scope?: string | null;
}): Promise<void> {
  if (!params.apiKey || typeof params.apiKey !== "string") {
    throw new Error("upsertOpenRouterLink: apiKey required");
  }
  const apiKeyEnc = encryptPassword(params.apiKey);
  await prisma.userOpenRouterLink.upsert({
    where: { userId: params.userId },
    update: {
      apiKeyEnc,
      openrouterEmail: params.openrouterEmail ?? null,
      scope: params.scope ?? null,
      connectedAt: new Date(),
      deletedAt: null,
    },
    create: {
      userId: params.userId,
      apiKeyEnc,
      openrouterEmail: params.openrouterEmail ?? null,
      scope: params.scope ?? null,
    },
  });
}

/** Disconnect — soft delete pour garder l'audit trail. */
export async function disconnectOpenRouterLink(userId: string): Promise<void> {
  await prisma.userOpenRouterLink
    .update({
      where: { userId },
      data: { deletedAt: new Date() },
    })
    .catch((err: unknown) => {
      const code = (err as { code?: string }).code;
      if (code !== "P2025") throw err;
    });
}

/** Fire-and-forget — bump lastUsedAt après chaque generate() utilisant la clé user. */
export async function recordOpenRouterLinkUsage(userId: string): Promise<void> {
  try {
    await prisma.userOpenRouterLink.update({
      where: { userId },
      data: { lastUsedAt: new Date() },
    });
  } catch (err) {
    console.warn("[openrouter/queries] recordUsage failed (non-blocking):", err);
  }
}
