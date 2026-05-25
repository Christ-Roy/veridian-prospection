/**
 * Cookie PKCE signé HMAC pour le flow OAuth OpenRouter.
 *
 * Le cookie HTTP-only stocke `{verifier, state, userId, nonce, exp}` signé
 * via HMAC-SHA256 dérivé d'AUTH_SECRET. Pas de chiffrement requis : le
 * cookie est HTTP-only (pas accessible JS) et le verifier n'est pas un
 * secret long-terme — juste un anti-replay/CSRF jeté à l'exchange.
 *
 * Pourquoi un fichier dédié et pas dans la route :
 *   Next.js (App Router) refuse les exports non-HTTP-verb dans `route.ts`
 *   ("PKCE_COOKIE_NAME is not a valid Route export field"). Le cookie name
 *   et la fonction verifyPayload doivent vivre dans `lib/` pour être
 *   importés par connect ET callback sans casser le typecheck Next.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const PKCE_COOKIE_NAME = "or_pkce";
export const PKCE_COOKIE_MAX_AGE_S = 600; // 10 min

/**
 * Signe le payload `{verifier, state, userId, nonce, exp}` avec HMAC-SHA256
 * dérivé d'AUTH_SECRET. Retourne `<base64url-json>.<base64url-sig>`.
 *
 * Throw si AUTH_SECRET manque ou trop court — fail-closed, on préfère un
 * 500 explicite qu'un cookie non-signé qui ferait fuiter le verifier.
 */
export function signPayload(payload: object): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET missing or too short");
  }
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

/** Vérifie + déserialise. Retourne null si signature KO, format KO ou secret manquant. */
export function verifyPayload(signed: string): object | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  const parts = signed.split(".");
  if (parts.length !== 2) return null;
  const [b64, sigGiven] = parts;
  const expected = createHmac("sha256", secret).update(b64).digest("base64url");
  const a = Buffer.from(sigGiven);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    return JSON.parse(json) as object;
  } catch {
    return null;
  }
}
