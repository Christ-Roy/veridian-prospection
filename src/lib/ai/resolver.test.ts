/**
 * Unit tests — resolveAdapter (priorité tenant config > Veridian fallback).
 *
 * Couvre les 3 branches d'arbitrage + sabotage : si on commente la branche
 * "tenant config prend la priorité sur Veridian fallback", un test casse
 * (le tenant ayant configuré sa clé doit débiter la sienne, pas la clé
 * globale Veridian).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.AUTH_SECRET = "x".repeat(32);

const { mockTenantFindUnique } = vi.hoisted(() => ({
  mockTenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantAiConfig: { findUnique: mockTenantFindUnique },
  },
}));

import { resolveAdapter } from "./resolver";
import { OpenRouterAdapter } from "./openrouter";
import { AnthropicAdapter } from "./anthropic";
import { encryptPassword } from "@/lib/crypto/encrypt-password";
import { VERIDIAN_DEFAULT_FREE_MODEL } from "./models";

beforeEach(() => {
  mockTenantFindUnique.mockReset();
  delete process.env.OPENROUTER_VERIDIAN_KEY;
});

describe("resolveAdapter — priorité 1 : tenant config", () => {
  it("retourne tenant-byo avec provider Anthropic", async () => {
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "t1",
      tenantId: "tenant-1",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKeyEnc: encryptPassword("sk-ant-tenant"),
      defaultLocale: "en",
    });

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r?.mode).toBe("tenant-byo");
    expect(r?.model).toBe("claude-sonnet-4-6");
    expect(r?.tenantId).toBe("tenant-1");
    expect(r?.adapter).toBeInstanceOf(AnthropicAdapter);
  });

  it("tenant config l'emporte sur Veridian fallback (tenant débite SA clé)", async () => {
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "t1",
      tenantId: "tenant-1",
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyEnc: encryptPassword("sk-ant-tenant"),
      defaultLocale: "fr",
    });
    process.env.OPENROUTER_VERIDIAN_KEY = "sk-or-v1-veridian-key";

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r?.mode).toBe("tenant-byo");
    expect(r?.provider).toBe("anthropic");
  });

  it("provider tenant unknown → null (refuse, ne fallback pas)", async () => {
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "t1",
      tenantId: "tenant-1",
      provider: "voodoo-ai",
      model: "x",
      apiKeyEnc: encryptPassword("k"),
      defaultLocale: "fr",
    });
    process.env.OPENROUTER_VERIDIAN_KEY = "sk-or-veridian";

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    // ⚠️ tenant config existe mais provider invalide → null (pas de glissement
    // silencieux vers Veridian — l'admin doit corriger la config tenant)
    expect(r).toBeNull();
  });
});

describe("resolveAdapter — priorité 2 : fallback Veridian", () => {
  it("aucune tenant config + ENV présente → veridian-free", async () => {
    mockTenantFindUnique.mockResolvedValueOnce(null);
    process.env.OPENROUTER_VERIDIAN_KEY = "sk-or-v1-veridian-key";

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r).not.toBeNull();
    expect(r?.mode).toBe("veridian-free");
    expect(r?.provider).toBe("openrouter");
    expect(r?.model).toBe(VERIDIAN_DEFAULT_FREE_MODEL);
    expect(r?.adapter).toBeInstanceOf(OpenRouterAdapter);
  });

  it("OPENROUTER_VERIDIAN_KEY vide string → null (pas de fallback bogus)", async () => {
    mockTenantFindUnique.mockResolvedValueOnce(null);
    process.env.OPENROUTER_VERIDIAN_KEY = "";

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r).toBeNull();
  });
});

describe("resolveAdapter — priorité 3 : aucun adapter dispo", () => {
  it("aucune tenant config + aucune env → null (→ 412)", async () => {
    mockTenantFindUnique.mockResolvedValueOnce(null);

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r).toBeNull();
  });
});
