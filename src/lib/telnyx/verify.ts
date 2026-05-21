/**
 * Vérification des signatures Telnyx Webhook v2 (Ed25519).
 *
 * Telnyx signe chaque webhook avec sa clé publique Ed25519 :
 *
 *     Telnyx-Signature-Ed25519: <base64(signature)>
 *     Telnyx-Timestamp: <unix_seconds>
 *
 * Message signé : `${timestamp}|${rawBody}` (utf-8).
 *
 * Doc : https://developers.telnyx.com/docs/v2/api/webhook-events#webhook-signatures
 *
 * La clé publique se récupère via :
 *   GET https://api.telnyx.com/v2/public_key (avec API key)
 * → `data.public` (base64, 32 octets bruts une fois décodés).
 *
 * Stockée en ENV `TELNYX_PUBLIC_KEY` (string base64).
 */
import { createPublicKey, verify, type KeyObject } from "crypto";

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

// Préfixe SPKI DER pour une clé Ed25519 brute (32 octets) :
//   30 2a — SEQUENCE de 42 octets
//   30 05 — SEQUENCE algoIdentifier
//   06 03 2b 65 70 — OID 1.3.101.112 (Ed25519)
//   03 21 00 — BIT STRING (33 octets, 0 bits ignorés)
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type TelnyxVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_public_key"
        | "missing_signature"
        | "missing_timestamp"
        | "invalid_timestamp"
        | "timestamp_drift"
        | "invalid_signature"
        | "malformed_public_key";
    };

let cachedKey: { b64: string; key: KeyObject } | null = null;

function loadPublicKey(publicKeyB64: string): KeyObject | null {
  if (cachedKey && cachedKey.b64 === publicKeyB64) return cachedKey.key;
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    if (raw.length !== 32) return null;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    cachedKey = { b64: publicKeyB64, key };
    return key;
  } catch {
    return null;
  }
}

/**
 * Vérifie un webhook Telnyx.
 *
 * @param publicKeyB64 Clé publique Telnyx (base64). Si vide → `missing_public_key`.
 * @param timestamp   Header `Telnyx-Timestamp` (unix seconds, en string).
 * @param signatureB64 Header `Telnyx-Signature-Ed25519` (base64).
 * @param rawBody     Body raw exact (octets), tel que reçu (pas re-stringifié).
 */
export function verifyTelnyxWebhook(
  publicKeyB64: string | undefined,
  timestamp: string | null,
  signatureB64: string | null,
  rawBody: string,
): TelnyxVerificationResult {
  if (!publicKeyB64) return { ok: false, reason: "missing_public_key" };
  if (!signatureB64) return { ok: false, reason: "missing_signature" };
  if (!timestamp) return { ok: false, reason: "missing_timestamp" };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "invalid_timestamp" };
  const tsMs = tsNum * 1000;
  if (Math.abs(Date.now() - tsMs) > MAX_TIMESTAMP_DRIFT_MS) {
    return { ok: false, reason: "timestamp_drift" };
  }

  const key = loadPublicKey(publicKeyB64);
  if (!key) return { ok: false, reason: "malformed_public_key" };

  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64, "base64");
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }
  if (sig.length !== 64) return { ok: false, reason: "invalid_signature" };

  const message = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
  try {
    if (verify(null, message, key, sig)) return { ok: true };
    return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }
}

export const TELNYX_TIMESTAMP_DRIFT_MS = MAX_TIMESTAMP_DRIFT_MS;
