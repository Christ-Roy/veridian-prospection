/**
 * Tests pour src/lib/hub/apiKey.ts — helpers api_key tenant (contrat Hub §6.2).
 */
import { describe, expect, test } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey } from "@/lib/hub/apiKey";

describe("generateApiKey", () => {
  test("produit 64 chars hex (256 bits d'entropie)", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("conforme à la regex extractBearerApiKey (16-256 chars, alphanum + _-)", () => {
    // 64 hex chars = [0-9a-f] = subset de [A-Za-z0-9_-] → toujours valide.
    const key = generateApiKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
  });

  test("génère des clés différentes à chaque appel (entropie réelle)", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });
});

describe("hashApiKey", () => {
  test("retourne sha256 hex (64 chars)", () => {
    const hash = hashApiKey("my-secret-key");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("déterministe — même input → même hash", () => {
    const a = hashApiKey("identical-secret");
    const b = hashApiKey("identical-secret");
    expect(a).toBe(b);
  });

  test("inputs différents → hash différent", () => {
    const a = hashApiKey("secret-a");
    const b = hashApiKey("secret-b");
    expect(a).not.toBe(b);
  });

  test("matches expected sha256 vector (cross-platform sanity)", () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(hashApiKey("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("verifyApiKey", () => {
  test("true quand le plain hashé match le hash stocké", () => {
    const plain = generateApiKey();
    const hash = hashApiKey(plain);
    expect(verifyApiKey(plain, hash)).toBe(true);
  });

  test("false quand le plain est différent", () => {
    const hash = hashApiKey("real-key");
    expect(verifyApiKey("wrong-key", hash)).toBe(false);
  });

  test("false quand le hash stocké est mal formé (longueur ≠ 64)", () => {
    // Hash tronqué (DB corruption ou injection foireuse) — on rejette sans crash.
    expect(verifyApiKey("any", "deadbeef")).toBe(false);
  });

  test("false sur empty string (pas de fallback permissif)", () => {
    const hash = hashApiKey("real");
    expect(verifyApiKey("", hash)).toBe(false);
  });
});
