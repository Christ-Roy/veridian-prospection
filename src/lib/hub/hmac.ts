/**
 * Aides d'authentification du contrat Hub (CONTRAT-HUB §6). La signature des appels du Hub se vérifie dans
 * `secrets.ts` et nulle part ailleurs : c'est là que vivent le secret courant et le second (VER-251).
 */
import { timingSafeEqual } from "crypto";

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

export type HmacVerificationResult =
  | { ok: true; mode: "standard" | "legacy_bearer" }
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
 * Comparaison `Authorization: Bearer <secret>` en temps constant.
 * Sert uniquement au moteur de recherche (`lib/search/auth.ts`, secret dédié).
 * Le Hub signe tous ses appels en HMAC §6.1 : le Bearer Hub est coupé.
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
