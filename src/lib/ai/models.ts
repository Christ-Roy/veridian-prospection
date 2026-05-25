/**
 * Whitelist des providers + models supportés pour la génération de mail IA.
 *
 * Source de vérité côté serveur (zod) ET côté UI (dropdown filtré par provider).
 * Toute valeur hors de cette liste = 400 Bad Request.
 *
 * Convention Veridian (CLAUDE.md) : pour Anthropic, on liste opus-4-7 /
 * sonnet-4-6 / haiku-4-5 et non les anciennes générations. Les autres
 * providers suivent leurs nommages officiels.
 *
 * Ajout d'un model : append ici + extends provider — pas de migration DB.
 */
export type AiProvider = "anthropic" | "openai" | "mistral" | "openrouter";

export interface AiModelChoice {
  /** Identifiant API exact à passer au provider. */
  id: string;
  /** Libellé UI court ("Claude Opus 4.7"). */
  label: string;
  /** Note (capacité, prix, latence) — affichée en helper text dans le dropdown. */
  hint?: string;
}

export const AI_PROVIDERS: AiProvider[] = [
  "anthropic",
  "openai",
  "mistral",
  "openrouter",
];

export const AI_MODELS: Record<AiProvider, AiModelChoice[]> = {
  anthropic: [
    {
      id: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      hint: "Le plus capable — recommandé pour mails ultra-personnalisés",
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      hint: "Équilibre coût/qualité — bon pour volume moyen",
    },
    {
      id: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      hint: "Le plus rapide et le moins cher — pour gros volumes",
    },
  ],
  openai: [
    {
      id: "gpt-4o",
      label: "GPT-4o",
      hint: "Modèle phare OpenAI",
    },
    {
      id: "gpt-4o-mini",
      label: "GPT-4o mini",
      hint: "Rapide et économique",
    },
    {
      id: "o1",
      label: "o1",
      hint: "Modèle de raisonnement (plus cher, plus lent)",
    },
  ],
  mistral: [
    {
      id: "mistral-large-latest",
      label: "Mistral Large",
      hint: "Modèle phare Mistral (FR)",
    },
    {
      id: "mistral-small-latest",
      label: "Mistral Small",
      hint: "Rapide et économique",
    },
  ],
  openrouter: [
    {
      id: "anthropic/claude-3.5-sonnet",
      label: "Claude 3.5 Sonnet (via OpenRouter)",
      hint: "Si pas d'accès direct Anthropic",
    },
    {
      id: "openai/gpt-4o",
      label: "GPT-4o (via OpenRouter)",
      hint: "Si pas d'accès direct OpenAI",
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct",
      label: "Llama 3.3 70B",
      hint: "Open-source, économique",
    },
  ],
};

/** Vrai si le couple (provider, model) est whitelisté. */
export function isValidModel(provider: string, model: string): boolean {
  if (!AI_PROVIDERS.includes(provider as AiProvider)) return false;
  return AI_MODELS[provider as AiProvider].some((m) => m.id === model);
}
