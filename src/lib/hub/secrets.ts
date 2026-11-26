/**
 * Secret partagé avec le Hub, renouvelable sans coupure (VER-251).
 *
 * - Courant : `HUB_API_SECRET`, sinon `TENANT_API_SECRET`. Seul à signer les appels sortants.
 * - Second, facultatif : `HUB_API_SECRET_SECOND`, accepté en vérification seulement. Absent, vide ou de moins de
 *   32 caractères : il ne valide rien.
 *
 * Renouveler : neuf posé en second des deux côtés, bascule courant/second, retrait de l'ancien.
 *
 * Deux formats (CONTRAT-HUB §6.1, VER-264, 26/11) ; le signataire est `veridian-hub/lib/hmac/signature-hub.ts` :
 * - v1, sans en-tête de version : `hex(hmac(secret, "{ts}.{corps}"))`. Ne lie ni la méthode, ni le chemin, ni la
 *   requête : une signature captée vaut 5 min sur une autre route. Refusée si `VERIDIAN_HMAC_REQUIRE_V2` est vrai.
 * - v2, `X-Veridian-Sig-Version: 2` : `hex(hmac(secret, "{ts}\n{MÉTHODE}\n{chemin}\n{requête}\n{hex(sha256(corps))}"))`,
 *   chemin et requête tels que reçus, encodés. Usage unique : une signature v2 déjà servie est refusée, toutes
 *   instances confondues (table compteurs). Mêmes règles que le CRM et Notifuse.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

import { consommer } from "@/lib/compteurs";

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
  | { ok: true; cle: "courant" | "second"; version?: "v1" | "v2" }
  | {
      ok: false;
      reason: "missing_secret" | "missing_signature" | "invalid_timestamp" | "timestamp_drift" | "invalid_signature" | "v1_refused" | "signature_replayed";
    };

/** Méthode, chemin et requête de l'appel, tels que reçus : ce que la v2 signe. */
export type RouteSignee = { methode: string; chemin: string; requete: string };

export function exigeV2(env: Env = process.env): boolean {
  return ["1", "true", "yes", "on"].includes((env.VERIDIAN_HMAC_REQUIRE_V2 ?? "").trim().toLowerCase());
}

const chaineSignee = (ts: number, corps: string, route?: RouteSignee): string =>
  route
    ? [String(ts), route.methode.toUpperCase(), route.chemin, route.requete, createHash("sha256").update(corps).digest("hex")].join("\n")
    : `${ts}.${corps}`;

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Signature v1 (`route` absente) ou v2 (`route` donnée), par le courant ou le second. Les deux sont toujours comparés.
 * N'applique ni l'usage unique ni l'exigence de v2 : c'est `verifierAppelHub`.
 */
export function verifierSignature(ts: number, corps: string, signature: string | null, env: Env = process.env, route?: RouteSignee): VerdictHub {
  const courant = secretCourant(env);
  if (!courant) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(Date.now() - ts) > HUB_TIMESTAMP_DRIFT_MS) return { ok: false, reason: "timestamp_drift" };
  if (!HEX64.test(signature)) return { ok: false, reason: "invalid_signature" };

  const recue = Buffer.from(signature, "hex");
  const signee = chaineSignee(ts, corps, route);
  const egale = (secret: string) => timingSafeEqual(recue, createHmac("sha256", secret).update(signee).digest());
  const second = secretSecond(env);
  // Pas de court-circuit : même travail quel que soit le secret qui a signé. Sans second, la comparaison ne compte pas.
  const parCourant = egale(courant);
  const parSecond = egale(second ?? courant) && second !== undefined;
  const version = route ? "v2" : "v1";
  if (parCourant) return { ok: true, cle: "courant", version };
  return parSecond ? { ok: true, cle: "second", version } : { ok: false, reason: "invalid_signature" };
}

/** Méthode, chemin et requête bruts de la requête reçue (encodés comme sur le fil, comme le Hub les signe). */
export function routeRecue(request: Pick<NextRequest, "method" | "url">): RouteSignee {
  const u = new URL(request.url);
  return { methode: request.method, chemin: u.pathname, requete: u.search.replace(/^\?/, "") };
}

/** Fenêtre de l'usage unique : la signature n'est valable que ±5 min autour de son horodatage. */
const FENETRE_USAGE_UNIQUE_MS = 2 * HUB_TIMESTAMP_DRIFT_MS;

/**
 * Vérifie un appel du Hub et garde la trace de sa provenance : version, chemin (jamais la chaîne de requête, qui porte
 * une adresse), adresse d'appel, et quel secret a signé. Jamais le secret, la signature ni le corps.
 * v2 : la signature est consommée (usage unique). v1 : refusée si `VERIDIAN_HMAC_REQUIRE_V2`.
 */
export async function verifierAppelHub(request: NextRequest, corps: string, env: Env = process.env): Promise<VerdictHub> {
  const v2 = (request.headers.get("x-veridian-sig-version") ?? "").trim() === "2";
  const ts = Number(request.headers.get("x-veridian-timestamp") ?? NaN);
  const signature = request.headers.get("x-veridian-hub-signature");
  let v: VerdictHub =
    !v2 && exigeV2(env) && secretCourant(env) && signature
      ? { ok: false, reason: "v1_refused" }
      : verifierSignature(ts, corps, signature, env, v2 ? routeRecue(request) : undefined);
  if (v.ok && v2) {
    const fenetre = new Date(Math.floor(ts / FENETRE_USAGE_UNIQUE_MS) * FENETRE_USAGE_UNIQUE_MS);
    const { accepte } = await consommer(`hub-sig:${(signature ?? "").toLowerCase()}`, fenetre, 1, 1);
    if (!accepte) v = { ok: false, reason: "signature_replayed" };
  }
  const propre = (s: string | null) => (s ?? "").replace(/[^0-9a-fA-F.:, ]/g, "").slice(0, 80) || "inconnue";
  const ligne = `[hub-hmac] ${v.ok ? `accepte cle=${v.cle} version=${v.version}` : `refus motif=${v.reason} version=${v2 ? "v2" : "v1"}`} chemin=${request.nextUrl.pathname} ip=${propre(request.headers.get("x-forwarded-for"))}`;
  if (v.ok) console.log(ligne);
  else console.warn(ligne);
  return v;
}
