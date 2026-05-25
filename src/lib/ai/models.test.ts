/**
 * Unit tests — whitelist providers + models.
 *
 * Source de vérité pour les dropdowns UI + validation Zod côté API.
 */
import { describe, it, expect } from "vitest";
import {
  AI_PROVIDERS,
  AI_MODELS,
  isValidModel,
  VERIDIAN_DEFAULT_FREE_MODEL,
} from "./models";

describe("AI_PROVIDERS", () => {
  it("contient les 4 providers attendus", () => {
    expect(AI_PROVIDERS).toEqual(["anthropic", "openai", "mistral", "openrouter"]);
  });
});

describe("AI_MODELS", () => {
  it("expose au moins 1 model par provider", () => {
    for (const p of AI_PROVIDERS) {
      expect(AI_MODELS[p].length).toBeGreaterThan(0);
    }
  });

  it("expose les models Anthropic conformes à la convention Veridian (4-7 / 4-6 / 4-5)", () => {
    const ids = AI_MODELS.anthropic.map((m) => m.id);
    expect(ids).toContain("claude-opus-4-7");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-haiku-4-5");
    // Verifie qu'on n'expose PAS les anciens generations (ce serait un piège
    // pour le client qui paierait pour un modèle obsolète).
    expect(ids).not.toContain("claude-3-opus");
    expect(ids).not.toContain("claude-3-haiku");
  });

  it("chaque model a un label et un id non vides", () => {
    for (const p of AI_PROVIDERS) {
      for (const m of AI_MODELS[p]) {
        expect(m.id.length).toBeGreaterThan(0);
        expect(m.label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("isValidModel", () => {
  it("accepte un couple valide", () => {
    expect(isValidModel("anthropic", "claude-opus-4-7")).toBe(true);
    expect(isValidModel("openai", "gpt-4o")).toBe(true);
    expect(isValidModel("mistral", "mistral-large-latest")).toBe(true);
    expect(isValidModel("openrouter", "anthropic/claude-3.5-sonnet")).toBe(true);
  });

  it("refuse un provider inconnu", () => {
    expect(isValidModel("groq", "any")).toBe(false);
    expect(isValidModel("", "")).toBe(false);
  });

  it("refuse un model hors whitelist du provider (préviens les typos)", () => {
    expect(isValidModel("anthropic", "gpt-4o")).toBe(false);
    expect(isValidModel("openai", "claude-opus-4-7")).toBe(false);
    expect(isValidModel("anthropic", "claude-opus-99")).toBe(false);
  });
});

// ── W9d 2026-05-25 : modèles :free OpenRouter + Veridian default ─────────────
describe("OpenRouter — modèles :free (Palier 1 fallback Veridian)", () => {
  it("expose au moins 3 modèles :free (DeepSeek + Llama + Gemma)", () => {
    const freeIds = AI_MODELS.openrouter
      .map((m) => m.id)
      .filter((id) => id.endsWith(":free"));
    expect(freeIds.length).toBeGreaterThanOrEqual(3);
    // Anti-régression : on garde au moins ces 3 modèles connus pour
    // fonctionner sur free tier OpenRouter en 2026.
    expect(freeIds).toContain("meta-llama/llama-3.3-70b-instruct:free");
    expect(freeIds).toContain("deepseek/deepseek-chat-v3-0324:free");
    expect(freeIds).toContain("google/gemma-2-9b-it:free");
  });

  it("VERIDIAN_DEFAULT_FREE_MODEL est dans la whitelist openrouter et finit par :free", () => {
    // Garde-fou : si demain on bumpe le default, il DOIT rester dans
    // la whitelist isValidModel (sinon /api/mail/ai-config refuserait
    // de l'enregistrer comme fallback côté tenant config).
    expect(VERIDIAN_DEFAULT_FREE_MODEL.endsWith(":free")).toBe(true);
    expect(isValidModel("openrouter", VERIDIAN_DEFAULT_FREE_MODEL)).toBe(true);
  });

  it("modèles :free ont un hint qui mentionne 'free' ou 'gratuit' (transparence UI)", () => {
    const freeModels = AI_MODELS.openrouter.filter((m) => m.id.endsWith(":free"));
    for (const m of freeModels) {
      const hint = (m.hint ?? "").toLowerCase();
      expect(hint).toMatch(/free|gratuit/);
    }
  });
});
