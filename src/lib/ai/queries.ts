/**
 * Queries DB pour la config AI tenant (mail IA v1).
 *
 * Sépare la vue "client safe" (clé API masquée "***") de la vue interne
 * (avec api_key_enc, consommée par l'adapter via decryptPassword).
 */
import { prisma } from "@/lib/prisma";
import {
  encryptPassword,
  isPasswordConfigured,
} from "@/lib/crypto/encrypt-password";
import { isValidModel, type AiProvider } from "./models";

/** Vue safe pour le client UI. Clé API JAMAIS exposée. */
export interface AiConfigPublic {
  provider: AiProvider | null;
  model: string | null;
  defaultLocale: string;
  /** True si une clé API est stockée (UI affiche "•••••••• ✓"). */
  apiKeyConfigured: boolean;
  lastUsedAt: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
}

export interface AiConfigInternal {
  id: string;
  tenantId: string;
  provider: string;
  model: string;
  apiKeyEnc: string;
  defaultLocale: string;
}

/** Lit la config AI d'un tenant en vue publique (pour UI). */
export async function getAiConfigPublic(
  tenantId: string,
): Promise<AiConfigPublic | null> {
  const row = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });
  if (!row) return null;
  return {
    provider: row.provider as AiProvider,
    model: row.model,
    defaultLocale: row.defaultLocale,
    apiKeyConfigured: isPasswordConfigured(row.apiKeyEnc),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    totalTokensIn: row.totalTokensIn,
    totalTokensOut: row.totalTokensOut,
  };
}

/** Lit la config AI d'un tenant en vue interne (avec clé chiffrée). */
export async function getAiConfigInternal(
  tenantId: string,
): Promise<AiConfigInternal | null> {
  const row = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });
  if (!row || !row.apiKeyEnc || row.apiKeyEnc.length === 0) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    model: row.model,
    apiKeyEnc: row.apiKeyEnc,
    defaultLocale: row.defaultLocale,
  };
}

export interface UpsertAiConfigInput {
  provider: AiProvider;
  model: string;
  /** Plaintext API key. Si undefined, on conserve la clé existante. */
  apiKey?: string;
  defaultLocale: "fr" | "en";
}

/**
 * Upsert la config AI d'un tenant. Chiffre la clé à la volée.
 *
 * Garde-fou : refuse l'insertion initiale sans clé (un tenant qui crée la
 * config DOIT fournir une clé). Sur update, omettre `apiKey` = rotation
 * hors clé (juste model/locale).
 *
 * Throw si (provider, model) hors whitelist.
 */
export async function upsertAiConfig(
  tenantId: string,
  input: UpsertAiConfigInput,
): Promise<AiConfigPublic> {
  if (!isValidModel(input.provider, input.model)) {
    throw new Error(
      `Unsupported (provider, model) combo: ${input.provider}/${input.model}`,
    );
  }

  const existing = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });
  const apiKeyEnc =
    input.apiKey && input.apiKey.length > 0
      ? encryptPassword(input.apiKey)
      : undefined;

  if (!existing && !apiKeyEnc) {
    throw new Error("First-time AI config creation requires an apiKey");
  }

  await prisma.tenantAiConfig.upsert({
    where: { tenantId },
    update: {
      provider: input.provider,
      model: input.model,
      ...(apiKeyEnc !== undefined ? { apiKeyEnc } : {}),
      defaultLocale: input.defaultLocale,
    },
    create: {
      tenantId,
      provider: input.provider,
      model: input.model,
      // Garanti non-null par le check ci-dessus.
      apiKeyEnc: apiKeyEnc!,
      defaultLocale: input.defaultLocale,
    },
  });

  const fresh = await getAiConfigPublic(tenantId);
  return fresh!;
}

/** Supprime la config AI d'un tenant (revoke complet). */
export async function deleteAiConfig(tenantId: string): Promise<void> {
  await prisma.tenantAiConfig
    .delete({ where: { tenantId } })
    .catch((err: unknown) => {
      // P2025 = "Record to delete does not exist" — idempotent, on swallow.
      const code = (err as { code?: string }).code;
      if (code !== "P2025") throw err;
    });
}

/**
 * Incrément non bloquant des compteurs d'usage.
 * Fire-and-forget : on log mais on ne throw pas (un échec de métrique
 * ne doit pas casser la génération de mail).
 */
export async function recordAiUsage(
  tenantId: string,
  tokensIn: number,
  tokensOut: number,
): Promise<void> {
  try {
    await prisma.tenantAiConfig.update({
      where: { tenantId },
      data: {
        lastUsedAt: new Date(),
        totalTokensIn: { increment: Math.max(0, Math.floor(tokensIn)) },
        totalTokensOut: { increment: Math.max(0, Math.floor(tokensOut)) },
      },
    });
  } catch (err) {
    console.warn("[ai/queries] recordAiUsage failed (non-blocking):", err);
  }
}
