/**
 * HMAC Hub authentication — pattern A du CONTRAT-HUB.md §6.1.
 *
 * Format de signature standard cross-app Veridian :
 *
 *     X-Veridian-Timestamp: <unix_ms>
 *     X-Veridian-Hub-Signature: <hex(hmac_sha256(secret, "{timestamp}.{raw_body}"))>
 *
 * Vérification :
 *   1) drift timestamp < 5min (anti-replay)
 *   2) recompute HMAC sur `${timestamp}.${rawBody}` avec le secret partagé
 *   3) comparaison en temps constant via `crypto.timingSafeEqual`
 *
 * Compatibilité legacy : pendant la fenêtre de migration coordonnée avec
 * l'agent Hub (cf todo/2026-05-19-hub-contract-conformity.md), on accepte
 * encore le format historique `HMAC(secret, "${email}:${timestamp}")` placé
 * dans le body si `ACCEPT_LEGACY_HMAC=1`. La fenêtre vise 30j, après quoi le
 * flag disparaît avec ses 2 helpers `_legacy*`.
 *
 * Le Hub appelle aussi Prospection en `Authorization: Bearer <secret>` (cf
 * `veridian-hub/app/api/prospection/regenerate-login/route.ts`). On garde ce
 * fallback sous `ACCEPT_LEGACY_BEARER=1` (default ON tant que la migration
 * Hub n'est pas live).
 */
import { createHmac, timingSafeEqual } from "crypto";

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

export type HmacVerificationResult =
  | { ok: true; mode: "standard" | "legacy_email_ts" | "legacy_bearer" }
  | {
      ok: false;
      reason:
        | "missing_secret"
        | "missing_signature"
        | "invalid_timestamp"
        | "timestamp_drift"
        | "invalid_signature"
        | "invalid_bearer";
    };

/**
 * Vérifie une signature HMAC au format contrat `{ts}.{body}`.
 *
 * @param secret  Secret partagé Hub/app (env `HUB_API_SECRET` côté app).
 * @param timestamp Header `X-Veridian-Timestamp` (unix ms).
 * @param rawBody Body request exactement tel qu'il a été reçu (raw bytes,
 *                pas re-stringifié — sinon les whitespace divergent).
 * @param signature Header `X-Veridian-Hub-Signature` (hex).
 */
export function verifyHubHmac(
  secret: string | undefined,
  timestamp: number,
  rawBody: string,
  signature: string,
): HmacVerificationResult {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
    return { ok: false, reason: "timestamp_drift" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  try {
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return { ok: false, reason: "invalid_signature" };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true, mode: "standard" };
}

/**
 * Vérifie l'ancien format `HMAC(secret, "${payload}:${timestamp}")`.
 * Conservé temporairement pour ne pas casser le Hub avant sa propre migration.
 *
 * @param payload Donnée signée historiquement (email, "e2e-cleanup", etc.).
 */
export function verifyLegacyEmailTsHmac(
  secret: string | undefined,
  payload: string,
  timestamp: number,
  signature: string,
): HmacVerificationResult {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
    return { ok: false, reason: "timestamp_drift" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${payload}:${timestamp}`)
    .digest("hex");

  try {
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return { ok: false, reason: "invalid_signature" };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true, mode: "legacy_email_ts" };
}

/**
 * Comparaison `Authorization: Bearer <secret>` en temps constant.
 * Conservé pour le Hub legacy (`regenerate-login`, `impersonate`).
 */
export function verifyLegacyBearer(
  secret: string | undefined,
  authorizationHeader: string | null,
): HmacVerificationResult {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!authorizationHeader) return { ok: false, reason: "invalid_bearer" };

  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authorizationHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "invalid_bearer" };
  try {
    if (!timingSafeEqual(a, b)) return { ok: false, reason: "invalid_bearer" };
  } catch {
    return { ok: false, reason: "invalid_bearer" };
  }
  return { ok: true, mode: "legacy_bearer" };
}

/**
 * Bearer api_key tenant — pattern B du CONTRAT-HUB.md §6.2.
 * Utilisé par `generateMagicLink` (P3 du ticket). 1 api_key = 1 workspace.
 *
 * Retourne `{ ok: true, apiKey }` pour permettre au handler de retrouver le
 * workspace en DB. Comparaison en temps constant impossible sans connaitre
 * la valeur attendue — on retourne la clé proprement extraite et le handler
 * fait un `findFirst({ where: { apiKey } })` (qui utilisera lui-même un
 * `crypto.timingSafeEqual` côté lookup hashé une fois la P3 livrée).
 */
export function extractBearerApiKey(
  authorizationHeader: string | null,
): { ok: true; apiKey: string } | { ok: false; reason: "invalid_bearer" } {
  if (!authorizationHeader) return { ok: false, reason: "invalid_bearer" };
  const m = authorizationHeader.match(/^Bearer\s+([A-Za-z0-9_-]{16,256})$/);
  if (!m) return { ok: false, reason: "invalid_bearer" };
  return { ok: true, apiKey: m[1] };
}

export const HUB_TIMESTAMP_DRIFT_MS = MAX_TIMESTAMP_DRIFT_MS;
