/**
 * Résolution de l'adapter IA pour un user/tenant donné.
 *
 * Ordre de priorité (premier match l'emporte) :
 *
 *   1. **Config tenant** (`tenant_ai_config`)
 *      → BYO clé tenant-wide (anthropic / openai / mistral / openrouter).
 *
 *   2. **Clé Veridian globale** (`OPENROUTER_VERIDIAN_KEY` env)
 *      → fallback gratuit. Tous les users ont IA par défaut sans setup.
 *      → modèle = `VERIDIAN_DEFAULT_FREE_MODEL` (modèle `:free` OpenRouter).
 *
 *   3. **Aucun** → null → la route /api/mail/generate retourne 412.
 *
 * Le `mode` retourné permet à la UI d'afficher le bon badge :
 *   - "veridian-free"  → "Génération offerte par Veridian"
 *   - "tenant-byo"      → "Clé tenant configurée"
 */
import type { AiAdapter } from "./adapter";
import { AnthropicAdapter } from "./anthropic";
import { OpenAiAdapter } from "./openai";
import { MistralAdapter } from "./mistral";
import { OpenRouterAdapter } from "./openrouter";
import { VERIDIAN_DEFAULT_FREE_MODEL, type AiProvider } from "./models";
import { decryptPassword } from "@/lib/crypto/encrypt-password";
import { getAiConfigInternal } from "./queries";

export type AdapterMode = "tenant-byo" | "veridian-free";

export interface ResolvedAdapter {
  adapter: AiAdapter;
  mode: AdapterMode;
  provider: AiProvider;
  model: string;
  /** Présent uniquement en mode tenant-byo pour bump lastUsedAt. */
  tenantId?: string;
}

/**
 * Résout l'adapter à utiliser pour un appel donné.
 * Retourne null seulement si :
 *   - pas de config tenant
 *   - `OPENROUTER_VERIDIAN_KEY` env absente
 */
export async function resolveAdapter(params: {
  userId: string;
  tenantId: string;
}): Promise<ResolvedAdapter | null> {
  // ─── 1. Config tenant ─────────────────────────────────────────────────
  const tenantConfig = await getAiConfigInternal(params.tenantId);
  if (tenantConfig) {
    const apiKey = decryptPassword(tenantConfig.apiKeyEnc);
    const provider = tenantConfig.provider as AiProvider;
    const model = tenantConfig.model;
    let adapter: AiAdapter;
    switch (provider) {
      case "anthropic":
        adapter = new AnthropicAdapter(apiKey, model);
        break;
      case "openai":
        adapter = new OpenAiAdapter(apiKey, model);
        break;
      case "mistral":
        adapter = new MistralAdapter(apiKey, model);
        break;
      case "openrouter":
        adapter = new OpenRouterAdapter(apiKey, model);
        break;
      default:
        return null;
    }
    return {
      adapter,
      mode: "tenant-byo",
      provider,
      model,
      tenantId: params.tenantId,
    };
  }

  // ─── 2. Clé Veridian globale ──────────────────────────────────────────
  const veridianKey = process.env.OPENROUTER_VERIDIAN_KEY;
  if (veridianKey && veridianKey.length > 0) {
    return {
      adapter: new OpenRouterAdapter(veridianKey, VERIDIAN_DEFAULT_FREE_MODEL),
      mode: "veridian-free",
      provider: "openrouter",
      model: VERIDIAN_DEFAULT_FREE_MODEL,
    };
  }

  // ─── 3. Aucun adapter dispo ───────────────────────────────────────────
  return null;
}
