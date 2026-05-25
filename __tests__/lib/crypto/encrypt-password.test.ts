/**
 * Tests AES-256-GCM round-trip pour les passwords SMTP tenants.
 *
 * Sabotage-test (cf feedback_sabotage_test_audit) : si on enlève l'auth tag
 * GCM, le test `decryptPassword rejects tampered ciphertext` doit rougir.
 */
import { describe, expect, test, beforeAll, beforeEach } from "vitest";
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

describe("rotation AUTH_SECRET — sabotage-test (hardening v1)", () => {
  // CONTRAT : si on rotate AUTH_SECRET, les passwords déjà chiffrés en DB
  // deviennent INDÉCHIFFRABLES (clé dérivée du SHA-256 du secret).
  // L'erreur DOIT être :
  //   - explicite (throw avec un message clair, pas "undefined is not iterable")
  //   - sûre : pas de leak de plaintext partiel ou de la clé
  //   - synchronisée : pas de promesse silencieuse qui résout undefined
  //
  // Pourquoi ce contrat est important :
  //   Si AUTH_SECRET est rotaté en prod, l'app DOIT remonter "decrypt_failed"
  //   côté /api/mail/send (et lead_emails.sentStatus="failed") sans crasher
  //   le process ni leak de password. C'est exactement ce que assert
  //   `sendMail()` quand passwordEnc devient corrompu — voir smtp.test.ts.

  // Restaure AUTH_SECRET à une valeur valide entre chaque test (chaque test
  // peut le rotate / delete et doit reprendre un état propre derrière lui).
  beforeEach(() => {
    process.env.AUTH_SECRET = "a".repeat(32);
  });

  test("rotation AUTH_SECRET → decrypt throw avec message explicite", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "secret-1-".repeat(4); // 36 chars
    const enc = encryptPassword("hunter2");

    // Rotation
    process.env.AUTH_SECRET = "secret-2-".repeat(4);
    let threw: Error | null = null;
    try {
      decryptPassword(enc);
    } catch (err) {
      threw = err as Error;
    }
    expect(threw, "decrypt avec mauvaise clé DOIT throw").not.toBeNull();
    expect(threw!.message).toBeTruthy();
    // Le message d'erreur ne doit pas leak la clé ni le plaintext.
    expect(threw!.message).not.toContain("hunter2");
    expect(threw!.message).not.toContain("secret-1-");
    expect(threw!.message).not.toContain("secret-2-");

    process.env.AUTH_SECRET = original;
  });

  test("rotation back → décrypte de nouveau le ciphertext d'origine", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "stable-secret-32-bytes-min-aaaaa";
    const enc = encryptPassword("hunter2");

    process.env.AUTH_SECRET = "different-secret-32-bytes-bbbbbb";
    expect(() => decryptPassword(enc)).toThrow();

    // Rollback de la rotation
    process.env.AUTH_SECRET = "stable-secret-32-bytes-min-aaaaa";
    expect(decryptPassword(enc)).toBe("hunter2");

    process.env.AUTH_SECRET = original;
  });

  test("AUTH_SECRET absent → throw clair (pas crash silencieux)", () => {
    // D'abord, chiffrer un blob valide AVEC un AUTH_SECRET set (sinon on
    // teste seulement le format invalide, pas l'absence de secret).
    process.env.AUTH_SECRET = "a".repeat(32);
    const enc = encryptPassword("hello");

    // Puis virer AUTH_SECRET et vérifier que les 2 fonctions throw clair.
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    expect(() => encryptPassword("x")).toThrow(/AUTH_SECRET/);
    expect(() => decryptPassword(enc)).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = original;
  });

  test("AUTH_SECRET juste à 32 chars → accepté (boundary)", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a".repeat(32);
    const enc = encryptPassword("hunter2");
    expect(decryptPassword(enc)).toBe("hunter2");
    process.env.AUTH_SECRET = original;
  });

  test("AUTH_SECRET 31 chars → rejeté (boundary)", () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a".repeat(31);
    expect(() => encryptPassword("x")).toThrow(/AUTH_SECRET/);
    process.env.AUTH_SECRET = original;
  });

  test("tampering du tag GCM → throw (intégrité)", () => {
    const enc = encryptPassword("hunter2");
    const [iv, tag, ct] = enc.split(":");
    const tagBuf = Buffer.from(tag!, "base64");
    tagBuf[0] = tagBuf[0]! ^ 0xff;
    const tampered = `${iv}:${tagBuf.toString("base64")}:${ct}`;
    expect(() => decryptPassword(tampered)).toThrow();
  });

  test("tampering de l'IV → throw (intégrité)", () => {
    const enc = encryptPassword("hunter2");
    const [iv, tag, ct] = enc.split(":");
    const ivBuf = Buffer.from(iv!, "base64");
    ivBuf[0] = ivBuf[0]! ^ 0xff;
    const tampered = `${ivBuf.toString("base64")}:${tag}:${ct}`;
    expect(() => decryptPassword(tampered)).toThrow();
  });

  test("IV de longueur invalide → throw clair", () => {
    const tag = Buffer.from("a".repeat(16)).toString("base64");
    const ct = Buffer.from("ciphertext").toString("base64");
    // IV 8 bytes au lieu de 12
    const shortIv = Buffer.from("a".repeat(8)).toString("base64");
    expect(() => decryptPassword(`${shortIv}:${tag}:${ct}`)).toThrow(
      /IV length/,
    );
  });

  test("decryptPassword ne leak jamais l'AUTH_SECRET en message d'erreur", () => {
    const original = process.env.AUTH_SECRET;
    const sensitive = "very-secret-prod-key-aaaaaaaaaaa";
    process.env.AUTH_SECRET = sensitive;
    try {
      decryptPassword("invalid");
    } catch (err) {
      expect((err as Error).message).not.toContain(sensitive);
    }
    process.env.AUTH_SECRET = original;
  });
});
