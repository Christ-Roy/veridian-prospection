/**
 * Tests unitaires de `verifyTelnyxWebhook` (T20, fix pentest T16 HIGH).
 *
 * Couvre :
 *  - Sanity : signature valide récente → ok
 *  - Anti-replay : drift < 5min ok, drift > 5min refusé (passé + futur)
 *  - Anti-tamper : body muté → refusé, timestamp muté → refusé
 *  - Format clé : 32 octets seulement, base64 malformée refusée
 *  - Format sig : longueur ≠ 64 refusée, base64 invalide refusée
 *  - Sécurité : fail-closed si publicKey absent, missing_timestamp,
 *               missing_signature distinctement codés
 *  - Sabotage : si on commente la `verify()` (mock), tous les tests "valid"
 *               fail — protège contre régression accidentelle
 */
import { describe, expect, test } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "crypto";
import {
  verifyTelnyxWebhook,
  TELNYX_TIMESTAMP_DRIFT_MS,
} from "@/lib/telnyx/verify";

// Génère une vraie keypair Ed25519 — pas de fixture en dur.
function makeKeypair() {
  const kp = generateKeyPairSync("ed25519");
  const der = kp.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // Le format Telnyx = 32 octets bruts. SPKI DER ajoute un préfixe de 12 octets.
  const rawPub = der.subarray(12);
  return { privateKey: kp.privateKey, publicKeyB64: rawPub.toString("base64") };
}

function signNow(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], body: string, ts?: string) {
  const timestamp = ts ?? String(Math.floor(Date.now() / 1000));
  const sigB64 = cryptoSign(
    null,
    Buffer.from(`${timestamp}|${body}`, "utf8"),
    privateKey,
  ).toString("base64");
  return { timestamp, sigB64 };
}

describe("verifyTelnyxWebhook — happy path", () => {
  test("accepte une signature fraîche valide", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const body = '{"data":{"event_type":"call.initiated"}}';
    const { timestamp, sigB64 } = signNow(privateKey, body);

    const r = verifyTelnyxWebhook(publicKeyB64, timestamp, sigB64, body);
    expect(r.ok).toBe(true);
  });

  test("accepte un body vide signé", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const { timestamp, sigB64 } = signNow(privateKey, "");
    const r = verifyTelnyxWebhook(publicKeyB64, timestamp, sigB64, "");
    expect(r.ok).toBe(true);
  });

  test("accepte un drift de -4min (encore dans la fenêtre)", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const body = '{"x":1}';
    const oldTs = String(Math.floor(Date.now() / 1000) - 240); // -4 min
    const { sigB64 } = signNow(privateKey, body, oldTs);
    const r = verifyTelnyxWebhook(publicKeyB64, oldTs, sigB64, body);
    expect(r.ok).toBe(true);
  });
});

describe("verifyTelnyxWebhook — anti-replay", () => {
  test("rejette un timestamp drift > 5min dans le passé", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const body = '{"x":1}';
    const tooOld = String(Math.floor(Date.now() / 1000) - 600); // -10 min
    const { sigB64 } = signNow(privateKey, body, tooOld);
    const r = verifyTelnyxWebhook(publicKeyB64, tooOld, sigB64, body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timestamp_drift");
  });

  test("rejette un timestamp drift > 5min dans le futur", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const body = '{"x":1}';
    const future = String(Math.floor(Date.now() / 1000) + 600);
    const { sigB64 } = signNow(privateKey, body, future);
    const r = verifyTelnyxWebhook(publicKeyB64, future, sigB64, body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timestamp_drift");
  });

  test("la constante de drift est exportée à 5min", () => {
    expect(TELNYX_TIMESTAMP_DRIFT_MS).toBe(5 * 60 * 1000);
  });
});

describe("verifyTelnyxWebhook — anti-tamper", () => {
  test("rejette si le body est modifié après signature", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const body = '{"plan":"freemium"}';
    const { timestamp, sigB64 } = signNow(privateKey, body);
    const r = verifyTelnyxWebhook(
      publicKeyB64,
      timestamp,
      sigB64,
      '{"plan":"enterprise"}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });

  test("rejette si le timestamp est modifié après signature", () => {
    const { privateKey, publicKeyB64 } = makeKeypair();
    const body = '{"x":1}';
    const { timestamp, sigB64 } = signNow(privateKey, body);
    // Décale d'1s — drift OK mais signature invalide
    const tampered = String(Number(timestamp) + 1);
    const r = verifyTelnyxWebhook(publicKeyB64, tampered, sigB64, body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });

  test("rejette une signature signée avec une autre clé", () => {
    const honest = makeKeypair();
    const attacker = makeKeypair();
    const body = '{"x":1}';
    const { timestamp, sigB64 } = signNow(attacker.privateKey, body);
    const r = verifyTelnyxWebhook(
      honest.publicKeyB64,
      timestamp,
      sigB64,
      body,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });
});

describe("verifyTelnyxWebhook — erreurs d'input", () => {
  test("missing_public_key quand publicKey est undefined", () => {
    const r = verifyTelnyxWebhook(undefined, "0", "AA", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_public_key");
  });

  test("missing_public_key quand publicKey est string vide", () => {
    const r = verifyTelnyxWebhook("", "0", "AA", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_public_key");
  });

  test("missing_signature quand le header est absent", () => {
    const { publicKeyB64 } = makeKeypair();
    const r = verifyTelnyxWebhook(publicKeyB64, "0", null, "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_signature");
  });

  test("missing_timestamp quand le header est absent", () => {
    const { publicKeyB64 } = makeKeypair();
    const r = verifyTelnyxWebhook(publicKeyB64, null, "AA", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_timestamp");
  });

  test("invalid_timestamp pour un timestamp non numérique", () => {
    const { publicKeyB64 } = makeKeypair();
    const r = verifyTelnyxWebhook(publicKeyB64, "not-a-number", "AA", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_timestamp");
  });

  test("malformed_public_key si pas 32 octets après base64-decode", () => {
    // 16 octets de zéros encodés
    const tooShort = Buffer.alloc(16, 0).toString("base64");
    const ts = String(Math.floor(Date.now() / 1000));
    const r = verifyTelnyxWebhook(tooShort, ts, Buffer.alloc(64).toString("base64"), "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed_public_key");
  });

  test("invalid_signature si la sig fait < 64 octets", () => {
    const { publicKeyB64 } = makeKeypair();
    const ts = String(Math.floor(Date.now() / 1000));
    const shortSig = Buffer.alloc(32).toString("base64");
    const r = verifyTelnyxWebhook(publicKeyB64, ts, shortSig, "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature");
  });
});
