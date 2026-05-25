/**
 * Résolution de l'adapter IA pour un user/tenant donné.
 *
 * Ordre de priorité (premier match l'emporte) :
 *
 *   1. **Link user OpenRouter** (`user_openrouter_link`)
 *      → la clé OAuth PKCE de l'utilisateur. Débite SON crédit OpenRouter.
 *      → modèle = défaut Veridian free OU dernier modèle choisi côté UI
 *        (TenantAiConfig.model si provider=openrouter, sinon fallback free).
 *
 *   2. **Config tenant** (`tenant_ai_config`)
 *      → BYO clé tenant-wide (anthropic / openai / mistral / openrouter).
 *
 *   3. **Clé Veridian globale** (`OPENROUTER_VERIDIAN_KEY` env)
 *      → fallback gratuit. Tous les users ont IA par défaut sans setup.
 *      → modèle = `VERIDIAN_DEFAULT_FREE_MODEL` (modèle `:free` OpenRouter).
 *
 *   4. **Aucun** → null → la route /api/mail/generate retourne 412.
 *
 * Le `mode` retourné permet à la UI d'afficher le bon badge :
 *   - "veridian-free"  → "Génération offerte par Veridian"
 *   - "user-byo"        → "Compte OpenRouter connecté (votre crédit)"
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
import { getOpenRouterLinkInternal } from "@/lib/openrouter/queries";

export type AdapterMode = "user-byo" | "tenant-byo" | "veridian-free";

export interface ResolvedAdapter {
  adapter: AiAdapter;
  mode: AdapterMode;
  provider: AiProvider;
  model: string;
  /** Présent uniquement en mode user-byo / tenant-byo pour bump lastUsedAt. */
  tenantId?: string;
  userId?: string;
}

/**
 * Résout l'adapter à utiliser pour un appel donné.
 * Retourne null seulement si :
 *   - pas de link user
 *   - pas de config tenant
 *   - `OPENROUTER_VERIDIAN_KEY` env absente
 */
export async function resolveAdapter(params: {
  userId: string;
  tenantId: string;
  /** Override locale/model côté tenant — passé tel quel à l'adapter en mode user-byo. */
  preferredModelForUserByo?: string;
}): Promise<ResolvedAdapter | null> {
  // ─── 1. Link user OpenRouter ───────────────────────────────────────────
  const link = await getOpenRouterLinkInternal(params.userId);
  if (link) {
    const apiKey = decryptPassword(link.apiKeyEnc);
    // Préfère le modèle de la config tenant si elle est sur openrouter,
    // sinon fallback sur le modèle free Veridian (gratuit chez l'user
    // s'il a déposé 10 USD, sinon plafonné à 50 req/jour).
    const tenantConfig = await getAiConfigInternal(params.tenantId);
    const model =
      params.preferredModelForUserByo ??
      (tenantConfig?.provider === "openrouter" ? tenantConfig.model : VERIDIAN_DEFAULT_FREE_MODEL);
    return {
      adapter: new OpenRouterAdapter(apiKey, model),
      mode: "user-byo",
      provider: "openrouter",
      model,
      userId: params.userId,
    };
  }

  // ─── 2. Config tenant ─────────────────────────────────────────────────
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

  // ─── 3. Clé Veridian globale ──────────────────────────────────────────
  const veridianKey = process.env.OPENROUTER_VERIDIAN_KEY;
  if (veridianKey && veridianKey.length > 0) {
    return {
      adapter: new OpenRouterAdapter(veridianKey, VERIDIAN_DEFAULT_FREE_MODEL),
      mode: "veridian-free",
      provider: "openrouter",
      model: VERIDIAN_DEFAULT_FREE_MODEL,
    };
  }

  // ─── 4. Aucun adapter dispo ───────────────────────────────────────────
  return null;
}
