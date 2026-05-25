/**
 * Unit tests — user_openrouter_link queries (W9d 2026-05-25).
 *
 * Couvre :
 *   - getOpenRouterLinkPublic : connecté=false si pas de row, si deletedAt non null
 *   - getOpenRouterLinkInternal : null si soft-deleted, retourne apiKeyEnc sinon
 *   - upsertOpenRouterLink : chiffre la clé via AES-256-GCM, écrase si reconnect
 *   - disconnectOpenRouterLink : soft delete, idempotent sur P2025
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.AUTH_SECRET = "x".repeat(32);

const { mockFindUnique, mockUpsert, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userOpenRouterLink: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      update: mockUpdate,
    },
  },
}));

import {
  getOpenRouterLinkPublic,
  getOpenRouterLinkInternal,
  upsertOpenRouterLink,
  disconnectOpenRouterLink,
} from "./queries";
import { decryptPassword } from "@/lib/crypto/encrypt-password";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockUpdate.mockReset();
});

describe("getOpenRouterLinkPublic", () => {
  it("retourne connected=false si pas de row", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const r = await getOpenRouterLinkPublic("u1");
    expect(r.connected).toBe(false);
    expect(r.openrouterEmail).toBeNull();
  });

  it("retourne connected=false si soft-deleted (deletedAt non null)", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "u1",
      apiKeyEnc: "x",
      connectedAt: new Date(),
      deletedAt: new Date(),
    });
    const r = await getOpenRouterLinkPublic("u1");
    expect(r.connected).toBe(false);
  });

  it("expose email + dates mais JAMAIS apiKeyEnc", async () => {
    const d = new Date("2026-05-25T10:00:00Z");
    mockFindUnique.mockResolvedValueOnce({
      userId: "u1",
      apiKeyEnc: "secret-key-encrypted",
      openrouterEmail: "user@example.com",
      connectedAt: d,
      lastUsedAt: null,
      deletedAt: null,
    });
    const r = await getOpenRouterLinkPublic("u1");
    expect(r.connected).toBe(true);
    expect(r.openrouterEmail).toBe("user@example.com");
    expect(r.connectedAt).toBe(d.toISOString());
    // Sabotage-test : la clé ne doit JAMAIS apparaitre dans la vue publique
    expect(JSON.stringify(r)).not.toContain("secret-key-encrypted");
    expect(JSON.stringify(r)).not.toContain("apiKey");
  });
});

describe("getOpenRouterLinkInternal", () => {
  it("retourne null si soft-deleted", async () => {
    mockFindUnique.mockResolvedValueOnce({
      apiKeyEnc: "abc",
      deletedAt: new Date(),
    });
    expect(await getOpenRouterLinkInternal("u1")).toBeNull();
  });

  it("retourne null si apiKeyEnc vide", async () => {
    mockFindUnique.mockResolvedValueOnce({ apiKeyEnc: "", deletedAt: null });
    expect(await getOpenRouterLinkInternal("u1")).toBeNull();
  });

  it("retourne apiKeyEnc pour usage adapter quand actif", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "id-1",
      userId: "u1",
      apiKeyEnc: "iv:tag:cipher",
      openrouterEmail: null,
      deletedAt: null,
    });
    const r = await getOpenRouterLinkInternal("u1");
    expect(r?.apiKeyEnc).toBe("iv:tag:cipher");
  });
});

describe("upsertOpenRouterLink", () => {
  it("chiffre la clé (round-trip AES-256-GCM) et appelle prisma.upsert", async () => {
    mockUpsert.mockResolvedValueOnce({});
    await upsertOpenRouterLink({
      userId: "u1",
      apiKey: "sk-or-v1-mysecret",
      openrouterEmail: "u@x.com",
    });
    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.userId).toBe("u1");
    // Round-trip : decryptPassword(apiKeyEnc) doit retourner la clé plaintext
    expect(decryptPassword(call.create.apiKeyEnc)).toBe("sk-or-v1-mysecret");
    expect(call.create.openrouterEmail).toBe("u@x.com");
    expect(call.update.deletedAt).toBeNull();
  });

  it("throw si apiKey manquante", async () => {
    await expect(
      upsertOpenRouterLink({ userId: "u1", apiKey: "" }),
    ).rejects.toThrow(/apiKey/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("apiKeyEnc présent en mode update aussi (reconnect écrase)", async () => {
    mockUpsert.mockResolvedValueOnce({});
    await upsertOpenRouterLink({
      userId: "u1",
      apiKey: "sk-or-v1-NEW",
    });
    const call = mockUpsert.mock.calls[0][0];
    expect(call.update.apiKeyEnc).toBeDefined();
    expect(decryptPassword(call.update.apiKeyEnc)).toBe("sk-or-v1-NEW");
  });
});

describe("disconnectOpenRouterLink", () => {
  it("appelle update pour soft delete (deletedAt: now)", async () => {
    mockUpdate.mockResolvedValueOnce({});
    await disconnectOpenRouterLink("u1");
    expect(mockUpdate).toHaveBeenCalledOnce();
    const call = mockUpdate.mock.calls[0][0];
    expect(call.where.userId).toBe("u1");
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("idempotent : swallow P2025 (record not found)", async () => {
    mockUpdate.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
    await expect(disconnectOpenRouterLink("u-unknown")).resolves.toBeUndefined();
  });

  it("re-throw les erreurs non-P2025", async () => {
    mockUpdate.mockRejectedValueOnce(Object.assign(new Error("db down"), { code: "P1001" }));
    await expect(disconnectOpenRouterLink("u1")).rejects.toThrow(/db down/);
  });
});
