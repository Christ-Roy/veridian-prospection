/**
 * Unit tests — ai/queries.ts (CRUD config + masquage clé API).
 *
 * Couvre :
 *   - GET public NE retourne JAMAIS apiKeyEnc (la fonction n'expose même
 *     pas le champ — sabotage-test prouve qu'aucune string clé n'est dans
 *     le retour, même si le mock fait fuiter).
 *   - upsert refuse l'insertion initiale sans apiKey
 *   - upsert refuse un (provider, model) hors whitelist
 *   - getAiConfigInternal retourne apiKeyEnc pour usage adapter
 *   - Round-trip crypto : encryptPassword → decryptPassword sur la clé
 *   - Tampering : modification ciphertext → decrypt throw
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.AUTH_SECRET = "x".repeat(32);

const { mockFindUnique, mockUpsert, mockDelete, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockDelete: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantAiConfig: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      delete: mockDelete,
      update: mockUpdate,
    },
  },
}));

import {
  getAiConfigPublic,
  getAiConfigInternal,
  upsertAiConfig,
  deleteAiConfig,
  recordAiUsage,
} from "./queries";
import { encryptPassword, decryptPassword } from "@/lib/crypto/encrypt-password";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
  mockUpdate.mockReset();
});

describe("getAiConfigPublic — masque la clé API", () => {
  it("retourne null si pas de row", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await getAiConfigPublic("t1")).toBeNull();
  });

  it("expose provider/model/locale + flag apiKeyConfigured, JAMAIS apiKeyEnc", async () => {
    const row = {
      id: "id1",
      tenantId: "t1",
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyEnc: "SECRET_iv:tag:cipher",
      defaultLocale: "fr",
      lastUsedAt: new Date("2026-05-25T12:00:00Z"),
      totalTokensIn: 100,
      totalTokensOut: 50,
    };
    mockFindUnique.mockResolvedValueOnce(row);
    const pub = await getAiConfigPublic("t1");
    expect(pub).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-7",
      defaultLocale: "fr",
      apiKeyConfigured: true,
      lastUsedAt: "2026-05-25T12:00:00.000Z",
      totalTokensIn: 100,
      totalTokensOut: 50,
    });
    // Sabotage-test : aucune propriété de l'objet retourné ne contient la
    // chaîne SECRET. Si quelqu'un ajoute `apiKey: row.apiKeyEnc` à la vue
    // publique, ce test rougit.
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("apiKeyEnc");
  });
});

describe("getAiConfigInternal — retourne apiKeyEnc pour adapter", () => {
  it("expose apiKeyEnc côté serveur", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "id1",
      tenantId: "t1",
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnc: "iv:tag:cipher",
      defaultLocale: "en",
      totalTokensIn: 0,
      totalTokensOut: 0,
      lastUsedAt: null,
    });
    const internal = await getAiConfigInternal("t1");
    expect(internal?.apiKeyEnc).toBe("iv:tag:cipher");
  });

  it("retourne null si apiKeyEnc vide", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "id1",
      tenantId: "t1",
      provider: "openai",
      model: "gpt-4o",
      apiKeyEnc: "",
      defaultLocale: "fr",
      totalTokensIn: 0,
      totalTokensOut: 0,
      lastUsedAt: null,
    });
    expect(await getAiConfigInternal("t1")).toBeNull();
  });
});

describe("upsertAiConfig — validation et garde-fous", () => {
  it("refuse un (provider, model) hors whitelist", async () => {
    await expect(
      upsertAiConfig("t1", {
        provider: "anthropic",
        model: "claude-3-opus", // ancien, pas dans la whitelist
        apiKey: "sk-xxx-long-enough",
        defaultLocale: "fr",
      }),
    ).rejects.toThrow(/Unsupported/);
  });

  it("refuse l'insertion initiale sans apiKey", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(
      upsertAiConfig("t1", {
        provider: "anthropic",
        model: "claude-opus-4-7",
        defaultLocale: "fr",
      }),
    ).rejects.toThrow(/requires an apiKey/);
  });

  it("chiffre la clé via encryptPassword au upsert", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // 1er find (existing check)
      .mockResolvedValueOnce({
        id: "id1",
        tenantId: "t1",
        provider: "anthropic",
        model: "claude-opus-4-7",
        apiKeyEnc: "iv:tag:c",
        defaultLocale: "fr",
        totalTokensIn: 0,
        totalTokensOut: 0,
        lastUsedAt: null,
      }); // 2e find (getAiConfigPublic après upsert)
    mockUpsert.mockResolvedValueOnce({});
    const result = await upsertAiConfig("t1", {
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKey: "sk-ant-real-key-1234",
      defaultLocale: "fr",
    });
    // Assert sur le RETOUR — sabotage `return null` rougit.
    expect(result).not.toBeNull();
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.apiKeyConfigured).toBe(true);
    // Assert que la clé est bien chiffrée et passée à Prisma.
    const args = mockUpsert.mock.calls[0][0];
    expect(args.create.apiKeyEnc).toBeDefined();
    // Format attendu : iv:tag:ciphertext (3 segments base64)
    expect(args.create.apiKeyEnc.split(":")).toHaveLength(3);
    // Ne stocke pas la clé en clair
    expect(args.create.apiKeyEnc).not.toContain("sk-ant-real-key-1234");
  });

  it("update sans apiKey : conserve la clé existante (omit du payload)", async () => {
    mockFindUnique
      .mockResolvedValueOnce({ apiKeyEnc: "old:enc:value" })
      .mockResolvedValueOnce({
        id: "id1",
        tenantId: "t1",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKeyEnc: "old:enc:value",
        defaultLocale: "fr",
        totalTokensIn: 0,
        totalTokensOut: 0,
        lastUsedAt: null,
      });
    mockUpsert.mockResolvedValueOnce({});
    const result = await upsertAiConfig("t1", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      defaultLocale: "fr",
    });
    // Assert sur le RETOUR (sinon sabotage `return null` reste vert).
    expect(result).not.toBeNull();
    expect(result.model).toBe("claude-sonnet-4-6");
    const args = mockUpsert.mock.calls[0][0];
    expect(args.update.apiKeyEnc).toBeUndefined();
    expect(args.update.model).toBe("claude-sonnet-4-6");
  });
});

describe("deleteAiConfig — idempotent", () => {
  it("ne throw pas si la config n'existe pas (P2025)", async () => {
    mockDelete.mockRejectedValueOnce(Object.assign(new Error("not found"), { code: "P2025" }));
    await expect(deleteAiConfig("t1")).resolves.toBeUndefined();
  });

  it("propage les autres erreurs", async () => {
    mockDelete.mockRejectedValueOnce(Object.assign(new Error("db down"), { code: "P1001" }));
    await expect(deleteAiConfig("t1")).rejects.toThrow("db down");
  });
});

describe("recordAiUsage — fire-and-forget", () => {
  it("ne throw jamais même si la DB plante", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("conn timeout"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordAiUsage("t1", 100, 50)).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });

  it("clampe les négatifs à 0 avant increment", async () => {
    mockUpdate.mockResolvedValueOnce({});
    await recordAiUsage("t1", -5, -10);
    const args = mockUpdate.mock.calls[0][0];
    expect(args.data.totalTokensIn).toEqual({ increment: 0 });
    expect(args.data.totalTokensOut).toEqual({ increment: 0 });
  });
});

// ─── Crypto round-trip + tampering ─────────────────────────────────────────
// La clé API utilise EXACTEMENT le même chiffrement que le SMTP password
// (lib/crypto/encrypt-password.ts). Ce test consolide la garantie côté
// ai-config — si quelqu'un casse la crypto, ces tests le détectent aussi.

describe("crypto API key round-trip (réutilise encrypt-password.ts)", () => {
  it("encrypt(K) → decrypt → K", () => {
    const key = "sk-ant-api03-real-key-1234567890";
    const enc = encryptPassword(key);
    expect(enc).not.toContain(key);
    expect(decryptPassword(enc)).toBe(key);
  });

  it("format de sortie : 3 segments base64 (iv:tag:cipher)", () => {
    const enc = encryptPassword("test-key-12345");
    const parts = enc.split(":");
    expect(parts).toHaveLength(3);
    // Vérif que chaque segment décode bien en base64.
    for (const p of parts) {
      expect(Buffer.from(p, "base64").toString("base64").replace(/=+$/, "")).toBe(
        p.replace(/=+$/, ""),
      );
    }
  });

  it("tampering sur le ciphertext → decrypt throw (auth tag check)", () => {
    const enc = encryptPassword("sk-original-key");
    const [iv, tag, cipher] = enc.split(":");
    // Flip un byte du cipher (re-encode base64 après mutation)
    const cipherBuf = Buffer.from(cipher, "base64");
    cipherBuf[0] = cipherBuf[0] ^ 0xff;
    const tampered = `${iv}:${tag}:${cipherBuf.toString("base64")}`;
    expect(() => decryptPassword(tampered)).toThrow();
  });

  it("tampering sur le tag → decrypt throw", () => {
    const enc = encryptPassword("sk-original");
    const [iv, tag, cipher] = enc.split(":");
    const tagBuf = Buffer.from(tag, "base64");
    tagBuf[0] = tagBuf[0] ^ 0xff;
    const tampered = `${iv}:${tagBuf.toString("base64")}:${cipher}`;
    expect(() => decryptPassword(tampered)).toThrow();
  });

  it("2 chiffrements de la même clé → ciphertexts différents (IV random)", () => {
    const k = "même-clé-secrète";
    const a = encryptPassword(k);
    const b = encryptPassword(k);
    expect(a).not.toBe(b);
    expect(decryptPassword(a)).toBe(k);
    expect(decryptPassword(b)).toBe(k);
  });
});
