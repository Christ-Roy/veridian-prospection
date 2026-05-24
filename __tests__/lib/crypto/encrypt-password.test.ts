/**
 * Tests AES-256-GCM round-trip pour les passwords SMTP tenants.
 *
 * Sabotage-test (cf feedback_sabotage_test_audit) : si on enlève l'auth tag
 * GCM, le test `decryptPassword rejects tampered ciphertext` doit rougir.
 */
import { describe, expect, test, beforeAll } from "vitest";
import {
  encryptPassword,
  decryptPassword,
  isPasswordConfigured,
} from "@/lib/crypto/encrypt-password";

beforeAll(() => {
  // 32 chars pile pour respecter la borne min côté getKey().
  process.env.AUTH_SECRET = "a".repeat(32);
});

describe("encryptPassword / decryptPassword", () => {
  test("round-trip restitues le plaintext exact", () => {
    const plain = "p@ssw0rd!ÂéçÜß🚀";
    const enc = encryptPassword(plain);
    expect(enc).not.toContain(plain);
    expect(decryptPassword(enc)).toBe(plain);
  });

  test("génère un IV différent à chaque appel (donc ciphertext différent)", () => {
    const plain = "same-password";
    const a = encryptPassword(plain);
    const b = encryptPassword(plain);
    expect(a).not.toBe(b);
    expect(decryptPassword(a)).toBe(plain);
    expect(decryptPassword(b)).toBe(plain);
  });

  test("format <iv>:<tag>:<ciphertext> à 3 parts", () => {
    const enc = encryptPassword("hello");
    expect(enc.split(":")).toHaveLength(3);
  });

  test("encryptPassword throw sur plaintext vide", () => {
    expect(() => encryptPassword("")).toThrow();
  });

  test("decryptPassword throw sur format invalide", () => {
    expect(() => decryptPassword("not-a-valid-format")).toThrow();
    expect(() => decryptPassword("only:two")).toThrow();
  });

  test("decryptPassword throw sur ciphertext tampered (auth tag GCM)", () => {
    const enc = encryptPassword("hello");
    const [iv, tag, ct] = enc.split(":");
    // Flip un bit dans le ciphertext → GCM doit rejeter.
    const ctBuf = Buffer.from(ct, "base64");
    ctBuf[0] = ctBuf[0]! ^ 0xff;
    const tampered = `${iv}:${tag}:${ctBuf.toString("base64")}`;
    expect(() => decryptPassword(tampered)).toThrow();
  });

  test("decryptPassword throw avec mauvaise clé (AUTH_SECRET changé)", () => {
    const enc = encryptPassword("hello");
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "b".repeat(32);
    expect(() => decryptPassword(enc)).toThrow();
    process.env.AUTH_SECRET = original;
  });

  test("encryptPassword throw si AUTH_SECRET trop court", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "too-short";
    expect(() => encryptPassword("x")).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = original;
  });
});

describe("isPasswordConfigured", () => {
  test("retourne true pour une string non vide", () => {
    expect(isPasswordConfigured("any-encrypted-blob")).toBe(true);
  });
  test("retourne false pour null/undefined/empty", () => {
    expect(isPasswordConfigured(null)).toBe(false);
    expect(isPasswordConfigured(undefined)).toBe(false);
    expect(isPasswordConfigured("")).toBe(false);
  });
});
