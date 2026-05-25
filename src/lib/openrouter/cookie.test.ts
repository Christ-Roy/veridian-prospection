/**
 * Unit tests — cookie HMAC signé pour OAuth PKCE OpenRouter (W9d 2026-05-25).
 *
 * Round-trip + sabotage-test : si on tamper le payload, signature KO →
 * verifyPayload retourne null (anti-attaque par modification du cookie).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PKCE_COOKIE_NAME, PKCE_COOKIE_MAX_AGE_S, signPayload, verifyPayload } from "./cookie";

beforeEach(() => {
  process.env.AUTH_SECRET = "x".repeat(32);
});

describe("PKCE_COOKIE_NAME / MAX_AGE", () => {
  it("nom stable or_pkce (pas de typo discrète)", () => {
    expect(PKCE_COOKIE_NAME).toBe("or_pkce");
  });
  it("MAX_AGE = 10 min (assez pour le user-flow OAuth, pas plus)", () => {
    expect(PKCE_COOKIE_MAX_AGE_S).toBe(600);
  });
});

describe("signPayload / verifyPayload", () => {
  it("round-trip : verify({sign(p)}) === p", () => {
    const payload = { verifier: "v", state: "s", userId: "u-1", exp: 999 };
    const signed = signPayload(payload);
    expect(signed.split(".").length).toBe(2);
    const got = verifyPayload(signed);
    expect(got).toEqual(payload);
  });

  it("tampering ciphertext → verifyPayload retourne null", () => {
    const signed = signPayload({ a: 1 });
    // On modifie 1 char dans la partie payload (avant le .)
    const [b64, sig] = signed.split(".");
    const tampered = `${b64.slice(0, -2)}XX.${sig}`;
    expect(verifyPayload(tampered)).toBeNull();
  });

  it("tampering signature → verifyPayload retourne null", () => {
    const signed = signPayload({ a: 1 });
    const tampered = `${signed.slice(0, -3)}XYZ`;
    expect(verifyPayload(tampered)).toBeNull();
  });

  it("format invalide (pas de point) → null", () => {
    expect(verifyPayload("not-a-signed-payload")).toBeNull();
  });

  it("signPayload throw si AUTH_SECRET trop court (fail-closed)", () => {
    process.env.AUTH_SECRET = "shortsecret";
    expect(() => signPayload({ a: 1 })).toThrow(/AUTH_SECRET/);
  });

  it("verifyPayload retourne null si AUTH_SECRET manquant (fail-closed silencieux)", () => {
    delete process.env.AUTH_SECRET;
    expect(verifyPayload("aaa.bbb")).toBeNull();
  });
});
