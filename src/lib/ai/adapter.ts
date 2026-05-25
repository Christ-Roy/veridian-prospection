/**
 * AI adapter — façade unique pour les 4 providers LLM (mail IA v1).
 *
 * Pourquoi un adapter et pas un appel direct dans la route :
 *  1. La route `/api/mail/generate` ne sait pas / ne veut pas savoir quel
 *     provider est configuré. Elle reçoit un `TenantAiConfig` et appelle
 *     `getAdapter(config).generateText(prompt)` — point.
 *  2. Chaque provider a son shape de payload, ses codes d'erreur, son
 *     comptage de tokens. L'adapter normalise tout ça.
 *  3. Test : on mock fetch global dans les tests d'adapter, on assert le
 *     shape du payload envoyé.
 *
 * Implémentation minimale v1 : pas de stream, pas de tool use, pas de
 * fallback multi-provider. Un seul call HTTP, un seul retour structuré.
 */
import type { TenantAiConfig } from "@prisma/client";
import { decryptPassword } from "@/lib/crypto/encrypt-password";
import type { AiProvider } from "./models";
import { AnthropicAdapter } from "./anthropic";
import { OpenAiAdapter } from "./openai";
import { MistralAdapter } from "./mistral";
import { OpenRouterAdapter } from "./openrouter";

export interface GenerateOptions {
  /** Limite tokens output. Défaut 2000 (mail = court). */
  maxTokens?: number;
  /** Température 0-1. Défaut 0.7 (mail commercial = un peu de créativité). */
  temperature?: number;
  /** System prompt — séparé du user prompt pour activer le caching côté Anthropic. */
  system?: string;
}

export interface GenerateResult {
  /** Texte brut retourné par le LLM (le caller parse en JSON ensuite). */
  text: string;
  /** Tokens input (prompt + system) — pour métriques tenant. */
  tokensIn: number;
  /** Tokens output (réponse) — pour métriques tenant. */
  tokensOut: number;
}

/**
 * Erreur classifiée pour l'adapter. La route appelante mappe :
 *   - "auth"    → 401 vers le client (clé invalide, à reconfigurer)
 *   - "rate"    → 429 (rate limit côté provider)
 *   - "server"  → 502 (provider down)
 *   - "invalid" → 400 (model inconnu, payload refusé)
 */
export class AiAdapterError extends Error {
  constructor(
    public readonly kind: "auth" | "rate" | "server" | "invalid" | "network",
    message: string,
    public readonly statusFromProvider?: number,
  ) {
    super(message);
    this.name = "AiAdapterError";
  }
}

export interface AiAdapter {
  generateText(
    userPrompt: string,
    opts?: GenerateOptions,
  ): Promise<GenerateResult>;
}

/**
 * Factory : retourne l'adapter approprié pour la config tenant donnée.
 *
 * Déchiffre la clé API à la volée (jamais conservée hors du closure
 * de l'instance). L'adapter encapsule la clé en clair dans son champ
 * privé pour la durée du call HTTP — pas de fuite en mémoire au-delà.
 */
export function getAdapter(
  config: Pick<TenantAiConfig, "provider" | "model" | "apiKeyEnc">,
): AiAdapter {
  const apiKey = decryptPassword(config.apiKeyEnc);
  const provider = config.provider as AiProvider;

  // Switch sur le provider — chaque adapter est juste une classe légère
  // (fetch HTTP, pas d'init lourd) donc l'import statique ne pèse rien
  // dans le bundle serveur.
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter(apiKey, config.model);
    case "openai":
      return new OpenAiAdapter(apiKey, config.model);
    case "mistral":
      return new MistralAdapter(apiKey, config.model);
    case "openrouter":
      return new OpenRouterAdapter(apiKey, config.model);
    default:
      throw new AiAdapterError(
        "invalid",
        `Unknown AI provider: ${config.provider}`,
      );
  }
}
