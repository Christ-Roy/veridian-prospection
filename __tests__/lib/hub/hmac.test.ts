/**
 * Tests unitaires pour `src/lib/hub/hmac.ts`.
 *
 * Couverts :
 *  - Bearer legacy temps constant
 *  - extractBearerApiKey valide les caractères autorisés
 */
import { describe, expect, test } from "vitest";
import {
  verifyLegacyBearer,
  extractBearerApiKey,
} from "@/lib/hub/hmac";

const SECRET = "test-secret-abcdef";

describe("verifyLegacyBearer", () => {
  test("accepte `Bearer <secret>`", () => {
    const v = verifyLegacyBearer(SECRET, `Bearer ${SECRET}`);
    expect(v).toEqual({ ok: true, mode: "legacy_bearer" });
  });

  test("rejette header null", () => {
    const v = verifyLegacyBearer(SECRET, null);
    expect(v.ok).toBe(false);
  });

  test("rejette mauvais secret", () => {
    const v = verifyLegacyBearer(SECRET, "Bearer wrong-secret");
    expect(v.ok).toBe(false);
  });

  test("rejette si secret absent", () => {
    const v = verifyLegacyBearer(undefined, `Bearer ${SECRET}`);
    expect(v).toEqual({ ok: false, reason: "missing_secret" });
  });
});

describe("extractBearerApiKey — pattern B contrat §6.2", () => {
  test("extrait une clé valide", () => {
    const v = extractBearerApiKey("Bearer abcdef0123456789ABCDEF");
    expect(v).toEqual({ ok: true, apiKey: "abcdef0123456789ABCDEF" });
  });

  test("rejette si pas de prefix Bearer", () => {
    const v = extractBearerApiKey("Token abcdef0123456789ABCDEF");
    expect(v.ok).toBe(false);
  });

  test("rejette si trop court", () => {
    const v = extractBearerApiKey("Bearer abc");
    expect(v.ok).toBe(false);
  });

  test("rejette caractères invalides", () => {
    const v = extractBearerApiKey("Bearer abc def 1234 5678 9012 3456");
    expect(v.ok).toBe(false);
  });
});
