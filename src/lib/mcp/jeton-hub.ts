/**
 * Vérification du jeton que la porte MCP du Hub présente à Prospection (veridian-hub/docs/CONTRAT-MCP.md) :
 * JWT ES256 de 5 min, clé publique sur le JWKS du Hub, `iss` = le Hub, `aud` = l'URL MCP de Prospection,
 * `sub` = hub_user_id. Aucun secret partagé : la seule chose que Prospection connaît, c'est l'adresse du Hub.
 *
 * WebCrypto natif plutôt qu'une bibliothèque : une signature ES256 JWT est déjà au format r||s (IEEE P1363)
 * qu'attend `crypto.subtle.verify` pour ECDSA.
 */
import { webcrypto } from "node:crypto";

export class JetonRefuse extends Error {}

/** `tenantId` : espace Hub signé par la porte après vérification d'appartenance ; l'app revérifie. */
export type IdentiteHub = { hubUserId: string; email: string; scope: string; clientId: string | null; clientNom: string | null; jti: string | null; tenantId: string | null };

type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string };
type Fetch = typeof fetch;

const DERIVE_S = 30; // tolérance d'horloge
const JWKS_TTL_MS = 60 * 60 * 1000; // contrat : cache ≤ 1 h
const RELECTURE_MIN_MS = 60 * 1000; // kid inconnu : une relecture forcée par minute au plus

export function hubIssuer(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HUB_MCP_ISSUER || "https://app.veridian.site").replace(/\/+$/, "");
}
export function mcpAudience(env: NodeJS.ProcessEnv = process.env): string {
  return env.MCP_PUBLIC_URL || "https://prospection.app.veridian.site/api/mcp";
}
function jwksUrl(env: NodeJS.ProcessEnv): string {
  return env.HUB_JWKS_URL || `${hubIssuer(env)}/.well-known/jwks.json`;
}

let cache: { url: string; cles: Map<string, CryptoKey>; lu: number } | null = null;
let derniereRelecture = 0;

/** Tests : oublie les clés en cache. */
export function _viderCacheJwks(): void {
  cache = null;
  derniereRelecture = 0;
}

async function lireJwks(url: string, fetchImpl: Fetch): Promise<Map<string, CryptoKey>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  } catch (err) {
    throw new JetonRefuse(`clés du Hub injoignables (${err instanceof Error ? err.message : "réseau"})`);
  }
  if (!res.ok) throw new JetonRefuse(`clés du Hub injoignables (HTTP ${res.status})`);
  const corps = (await res.json().catch(() => null)) as { keys?: Jwk[] } | null;
  const cles = new Map<string, CryptoKey>();
  for (const jwk of corps?.keys ?? []) {
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.kid || jwk.d) continue;
    if (jwk.use && jwk.use !== "sig") continue;
    const { kid, ...cle } = jwk;
    cles.set(kid, await webcrypto.subtle.importKey("jwk", cle, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  return cles;
}

async function cle(kid: string, env: NodeJS.ProcessEnv, fetchImpl: Fetch, maintenant: number): Promise<CryptoKey> {
  const url = jwksUrl(env);
  if (!cache || cache.url !== url || maintenant - cache.lu > JWKS_TTL_MS) {
    cache = { url, cles: await lireJwks(url, fetchImpl), lu: maintenant };
  }
  let c = cache.cles.get(kid);
  // Rotation de clé côté Hub : un kid inconnu provoque une relecture, bornée pour qu'un jeton
  // forgé ne transforme pas Prospection en relais de requêtes vers le Hub.
  if (!c && maintenant - derniereRelecture > RELECTURE_MIN_MS) {
    derniereRelecture = maintenant;
    cache = { url, cles: await lireJwks(url, fetchImpl), lu: maintenant };
    c = cache.cles.get(kid);
  }
  if (!c) throw new JetonRefuse("clé de signature inconnue");
  return c;
}

function b64url(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) throw new JetonRefuse("jeton mal formé");
  return Buffer.from(segment, "base64url");
}

function json(segment: string): Record<string, unknown> {
  try {
    const v = JSON.parse(b64url(segment).toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* plus bas */
  }
  throw new JetonRefuse("jeton mal formé");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifierJetonHub(
  jeton: string,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: Fetch; maintenant?: number } = {},
): Promise<IdentiteHub> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maintenant = opts.maintenant ?? Date.now();

  const parts = jeton.split(".");
  if (parts.length !== 3) throw new JetonRefuse("jeton mal formé");
  const [h, p, s] = parts;
  const entete = json(h);
  if (entete.alg !== "ES256") throw new JetonRefuse("algorithme refusé");
  if (typeof entete.kid !== "string" || !entete.kid) throw new JetonRefuse("kid absent");

  const signature = b64url(s);
  if (signature.length !== 64) throw new JetonRefuse("signature mal formée");
  const ok = await webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await cle(entete.kid, env, fetchImpl, maintenant),
    signature,
    Buffer.from(`${h}.${p}`, "ascii"),
  );
  if (!ok) throw new JetonRefuse("signature invalide");

  const c = json(p);
  const sec = Math.floor(maintenant / 1000);
  if (c.iss !== hubIssuer(env)) throw new JetonRefuse("émetteur inattendu");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(mcpAudience(env))) throw new JetonRefuse("jeton destiné à une autre app");
  if (typeof c.exp !== "number" || c.exp + DERIVE_S < sec) throw new JetonRefuse("jeton expiré");
  if (typeof c.nbf === "number" && c.nbf - DERIVE_S > sec) throw new JetonRefuse("jeton pas encore valide");
  if (typeof c.iat === "number" && c.iat - DERIVE_S > sec) throw new JetonRefuse("jeton émis dans le futur");
  if (typeof c.sub !== "string" || !UUID.test(c.sub)) throw new JetonRefuse("sujet invalide");
  if (c.email_verified !== true || typeof c.email !== "string") throw new JetonRefuse("adresse non prouvée");

  return {
    hubUserId: c.sub.toLowerCase(),
    email: c.email,
    scope: typeof c.scope === "string" ? c.scope : "",
    clientId: typeof c.client_id === "string" ? c.client_id : null,
    // Nom du client OAuth (« Claude », « ChatGPT »), si le Hub le fournit ; affichage seulement.
    clientNom: typeof c.client_name === "string" && c.client_name.trim() ? c.client_name.trim().slice(0, 80) : null,
    jti: typeof c.jti === "string" ? c.jti : null,
    tenantId: typeof c.tenant_id === "string" && UUID.test(c.tenant_id) ? c.tenant_id.toLowerCase() : null,
  };
}
