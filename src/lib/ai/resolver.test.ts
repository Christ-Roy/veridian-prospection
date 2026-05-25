/**
 * Unit tests — resolveAdapter (priorité link user > tenant config > Veridian fallback).
 *
 * Couvre les 4 branches d'arbitrage + sabotage-test : si on commente
 * volontairement la branche "user link prend la priorité", un test
 * doit casser. C'est la garantie qu'un user qui a connecté son compte
 * débite SON crédit, pas le fallback Veridian gratuit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.AUTH_SECRET = "x".repeat(32);

const { mockLinkFindUnique, mockTenantFindUnique } = vi.hoisted(() => ({
  mockLinkFindUnique: vi.fn(),
  mockTenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userOpenRouterLink: { findUnique: mockLinkFindUnique },
    tenantAiConfig: { findUnique: mockTenantFindUnique },
  },
}));

import { resolveAdapter } from "./resolver";
import { OpenRouterAdapter } from "./openrouter";
import { AnthropicAdapter } from "./anthropic";
import { encryptPassword } from "@/lib/crypto/encrypt-password";
import { VERIDIAN_DEFAULT_FREE_MODEL } from "./models";

beforeEach(() => {
  mockLinkFindUnique.mockReset();
  mockTenantFindUnique.mockReset();
  delete process.env.OPENROUTER_VERIDIAN_KEY;
});

describe("resolveAdapter — priorité 1 : link user OpenRouter", () => {
  it("user-byo l'emporte sur tenant config (clé user débite SON crédit)", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "l1",
      userId: "u1",
      apiKeyEnc: encryptPassword("sk-or-v1-USER"),
      openrouterEmail: null,
      deletedAt: null,
    });
    // Tenant a aussi une config Anthropic — DOIT être ignorée car user link existe
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "t1",
      tenantId: "tenant-1",
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyEnc: encryptPassword("sk-ant-tenant"),
      defaultLocale: "fr",
    });

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r).not.toBeNull();
    expect(r?.mode).toBe("user-byo");
    expect(r?.provider).toBe("openrouter");
    expect(r?.adapter).toBeInstanceOf(OpenRouterAdapter);
  });

  it("link user + tenant openrouter → reprend le modèle du tenant", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      apiKeyEnc: encryptPassword("sk-or-v1-USER"),
      deletedAt: null,
    });
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "t1",
      tenantId: "tenant-1",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      apiKeyEnc: encryptPassword("sk-or-tenant"),
      defaultLocale: "fr",
    });

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r?.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("link user soft-deleted → tombe sur tenant config", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      apiKeyEnc: encryptPassword("sk-or-USER"),
      deletedAt: new Date(),
    });
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "t1",
      tenantId: "tenant-1",
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyEnc: encryptPassword("sk-ant"),
      defaultLocale: "fr",
    });

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r?.mode).toBe("tenant-byo");
    expect(r?.provider).toBe("anthropic");
    expect(r?.adapter).toBeInstanceOf(AnthropicAdapter);
  });
});

describe("resolveAdapter — priorité 2 : tenant config", () => {
  it("retourne tenant-byo avec provider Anthropic", async () => {
    mockLinkFindUnique.mockResolvedValueOnce(null);
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
  });

  it("provider tenant unknown → null (refuse, ne fallback pas)", async () => {
    mockLinkFindUnique.mockResolvedValueOnce(null);
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

describe("resolveAdapter — priorité 3 : fallback Veridian", () => {
  it("aucun link + aucune tenant config + ENV présente → veridian-free", async () => {
    mockLinkFindUnique.mockResolvedValueOnce(null);
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
    mockLinkFindUnique.mockResolvedValueOnce(null);
    mockTenantFindUnique.mockResolvedValueOnce(null);
    process.env.OPENROUTER_VERIDIAN_KEY = "";

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r).toBeNull();
  });
});

describe("resolveAdapter — priorité 4 : aucun adapter dispo", () => {
  it("aucun link + aucune tenant config + aucune env → null (→ 412)", async () => {
    mockLinkFindUnique.mockResolvedValueOnce(null);
    mockTenantFindUnique.mockResolvedValueOnce(null);

    const r = await resolveAdapter({ userId: "u1", tenantId: "tenant-1" });
    expect(r).toBeNull();
  });
});
