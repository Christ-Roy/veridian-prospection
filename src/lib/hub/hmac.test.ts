/**
 * Tests unitaires pour `src/lib/hub/hmac.ts`.
 *
 * Couverts :
 *  - signature standard `{ts}.{body}` correcte/incorrecte
 *  - anti-replay (drift > 5min ⇒ rejet)
 *  - secret manquant
 *  - body modifié = signature invalide (collision-proof)
 *  - timingSafeEqual ne plante pas sur longueurs différentes
 *  - format legacy `payload:ts` accepté et bien isolé
 *  - Bearer legacy temps constant
 *  - extractBearerApiKey valide les caractères autorisés
 */
import { describe, expect, test } from "vitest";
import { createHmac } from "crypto";
import {
  verifyHubHmac,
  verifyLegacyEmailTsHmac,
  verifyLegacyBearer,
  extractBearerApiKey,
  HUB_TIMESTAMP_DRIFT_MS,
} from "./hmac";

const SECRET = "test-secret-abcdef";

function sign(ts: number, body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

describe("verifyHubHmac — pattern A contrat §6.1", () => {
  test("accepte une signature correcte", () => {
    const ts = Date.now();
    const body = JSON.stringify({ tenant_id: "t-1", owner_email: "a@b.c" });
    const sig = sign(ts, body);
    const v = verifyHubHmac(SECRET, ts, body, sig);
    expect(v).toEqual({ ok: true, mode: "standard" });
  });

  test("rejette si secret absent", () => {
    const v = verifyHubHmac(undefined, Date.now(), "{}", "00".repeat(32));
    expect(v).toEqual({ ok: false, reason: "missing_secret" });
  });

  test("rejette si signature absente", () => {
    const v = verifyHubHmac(SECRET, Date.now(), "{}", "");
    expect(v).toEqual({ ok: false, reason: "missing_signature" });
  });

  test("rejette si timestamp NaN", () => {
    const v = verifyHubHmac(SECRET, NaN, "{}", "00".repeat(32));
    expect(v).toEqual({ ok: false, reason: "invalid_timestamp" });
  });

  test("rejette si drift > 5min", () => {
    const ts = Date.now() - (HUB_TIMESTAMP_DRIFT_MS + 1000);
    const body = "{}";
    const sig = sign(ts, body);
    const v = verifyHubHmac(SECRET, ts, body, sig);
    expect(v).toEqual({ ok: false, reason: "timestamp_drift" });
  });

  test("rejette si signature mauvaise", () => {
    const v = verifyHubHmac(SECRET, Date.now(), "{}", "00".repeat(32));
    expect(v).toEqual({ ok: false, reason: "invalid_signature" });
  });

  test("rejette si body modifié après signature", () => {
    const ts = Date.now();
    const sig = sign(ts, "{}");
    const v = verifyHubHmac(SECRET, ts, "{\"a\":1}", sig);
    expect(v).toEqual({ ok: false, reason: "invalid_signature" });
  });

  test("rejette si secret rotaté", () => {
    const ts = Date.now();
    const sig = sign(ts, "{}", "old-secret");
    const v = verifyHubHmac(SECRET, ts, "{}", sig);
    expect(v).toEqual({ ok: false, reason: "invalid_signature" });
  });

  test("ne crash pas sur signature hex de longueur différente", () => {
    const v = verifyHubHmac(SECRET, Date.now(), "{}", "abc"); // 3 chars → 1 byte
    expect(v.ok).toBe(false);
    // Soit invalid_signature soit invalid_signature : pas de throw.
  });

  test("ne crash pas sur signature non-hex", () => {
    const v = verifyHubHmac(SECRET, Date.now(), "{}", "not-hex-at-all-zzz");
    expect(v.ok).toBe(false);
  });
});

describe("verifyLegacyEmailTsHmac — fenêtre 30j de migration", () => {
  test("accepte le format historique email:ts", () => {
    const ts = Date.now();
    const sig = createHmac("sha256", SECRET)
      .update(`client@example.com:${ts}`)
      .digest("hex");
    const v = verifyLegacyEmailTsHmac(SECRET, "client@example.com", ts, sig);
    expect(v).toEqual({ ok: true, mode: "legacy_email_ts" });
  });

  test("rejette si payload changé", () => {
    const ts = Date.now();
    const sig = createHmac("sha256", SECRET)
      .update(`client@example.com:${ts}`)
      .digest("hex");
    const v = verifyLegacyEmailTsHmac(SECRET, "other@example.com", ts, sig);
    expect(v.ok).toBe(false);
  });

  test("rejette si drift > 5min", () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const sig = createHmac("sha256", SECRET)
      .update(`client@example.com:${ts}`)
      .digest("hex");
    const v = verifyLegacyEmailTsHmac(SECRET, "client@example.com", ts, sig);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("timestamp_drift");
  });
});

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
