/**
 * Secret partagé avec le Hub, renouvelable sans coupure (VER-251).
 *
 * - Courant : `HUB_API_SECRET`, sinon `TENANT_API_SECRET`. Seul à signer les appels sortants.
 * - Second, facultatif : `HUB_API_SECRET_SECOND`, accepté en vérification seulement. Absent, vide ou de moins de
 *   32 caractères : il ne valide rien.
 *
 * Renouveler : neuf posé en second des deux côtés, bascule courant/second, retrait de l'ancien.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { HUB_TIMESTAMP_DRIFT_MS } from "./hmac";

export const SECOND_MIN = 32;

type Env = Record<string, string | undefined>;

export function secretCourant(env: Env = process.env): string | undefined {
  return env.HUB_API_SECRET || env.TENANT_API_SECRET || undefined;
}

export function secretSecond(env: Env = process.env): string | undefined {
  const s = env.HUB_API_SECRET_SECOND;
  return s && s.trim().length >= SECOND_MIN ? s : undefined;
}

export type VerdictHub =
  | { ok: true; cle: "courant" | "second" }
  | { ok: false; reason: "missing_secret" | "missing_signature" | "invalid_timestamp" | "timestamp_drift" | "invalid_signature" };

const HEX64 = /^[0-9a-f]{64}$/i;

/** Signature `hex(hmac_sha256(secret, "{ts}.{corps}"))`, par le courant ou le second. Les deux sont toujours comparés. */
export function verifierSignature(ts: number, corps: string, signature: string | null, env: Env = process.env): VerdictHub {
  const courant = secretCourant(env);
  if (!courant) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(Date.now() - ts) > HUB_TIMESTAMP_DRIFT_MS) return { ok: false, reason: "timestamp_drift" };
  if (!HEX64.test(signature)) return { ok: false, reason: "invalid_signature" };

  const recue = Buffer.from(signature, "hex");
  const egale = (secret: string) => timingSafeEqual(recue, createHmac("sha256", secret).update(`${ts}.${corps}`).digest());
  const second = secretSecond(env);
  // Pas de court-circuit : même travail quel que soit le secret qui a signé. Sans second, la comparaison ne compte pas.
  const parCourant = egale(courant);
  const parSecond = egale(second ?? courant) && second !== undefined;
  if (parCourant) return { ok: true, cle: "courant" };
  return parSecond ? { ok: true, cle: "second" } : { ok: false, reason: "invalid_signature" };
}

/**
 * Vérifie un appel du Hub et garde la trace de sa provenance : chemin (jamais la chaîne de requête, qui porte une
 * adresse), adresse d'appel, et quel secret a signé. Jamais le secret, la signature ni le corps.
 */
export function verifierAppelHub(request: NextRequest, corps: string): VerdictHub {
  const v = verifierSignature(Number(request.headers.get("x-veridian-timestamp") ?? NaN), corps, request.headers.get("x-veridian-hub-signature"));
  const propre = (s: string | null) => (s ?? "").replace(/[^0-9a-fA-F.:, ]/g, "").slice(0, 80) || "inconnue";
  const ligne = `[hub-hmac] ${v.ok ? `accepte cle=${v.cle}` : `refus motif=${v.reason}`} chemin=${request.nextUrl.pathname} ip=${propre(request.headers.get("x-forwarded-for"))}`;
  if (v.ok) console.log(ligne);
  else console.warn(ligne);
  return v;
}
