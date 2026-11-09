/**
 * Client sortant Prospection → Hub : `GET /api/hub/connexions-ia?hub_user_id=…` (HMAC §6.1 sur
 * `${timestamp}.`, corps vide). Le Hub est la source des IA reliées à un compte : Atlas montre ainsi
 * « Claude branché » dès la connexion, avant le premier appel d'outil (la porte MCP ne contacte une app
 * qu'à l'exécution d'un outil).
 *
 * Au mieux : une panne, un délai ou un secret absent rendent `null`, jamais une exception. Cache de 60 s
 * par compte : l'écran relit chaque minute.
 */
import { createHmac } from "crypto";

export type ConnexionHub = { nom: string; depuis: string | null; derniere_utilisation: string | null };

const CACHE_MS = 60_000;
const cache = new Map<string, { t: number; v: ConnexionHub[] }>();

function hubUrl(env: NodeJS.ProcessEnv): string {
  return (env.HUB_API_URL || env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site").replace(/\/$/, "");
}

export async function connexionsIaHub(
  hubUserId: string | null,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; maintenant?: number; timeoutMs?: number } = {},
): Promise<ConnexionHub[] | null> {
  const env = opts.env ?? process.env;
  const secret = env.HUB_API_SECRET || env.TENANT_API_SECRET;
  if (!hubUserId || !secret) return null;
  const maintenant = opts.maintenant ?? Date.now();
  const enCache = cache.get(hubUserId);
  if (enCache && maintenant - enCache.t < CACHE_MS) return enCache.v;

  const ts = String(maintenant);
  const signature = createHmac("sha256", secret).update(`${ts}.`).digest("hex");
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${hubUrl(env)}/api/hub/connexions-ia?hub_user_id=${encodeURIComponent(hubUserId)}`, {
      headers: { "X-Veridian-Timestamp": ts, "X-Veridian-Hub-Signature": signature, Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[hub] connexions-ia : ${res.status}`);
      return null;
    }
    const corps = (await res.json()) as { connexions?: { client?: unknown; depuis?: unknown; derniere_utilisation?: unknown }[] };
    const v = (corps.connexions ?? [])
      .filter((c) => typeof c.client === "string" && c.client.trim())
      .map((c) => ({
        nom: String(c.client).trim().slice(0, 80),
        depuis: typeof c.depuis === "string" ? c.depuis : null,
        derniere_utilisation: typeof c.derniere_utilisation === "string" ? c.derniere_utilisation : null,
      }));
    cache.set(hubUserId, { t: maintenant, v });
    return v;
  } catch (e) {
    console.warn("[hub] connexions-ia injoignable", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Pour les tests. */
export function viderCacheConnexionsIa() {
  cache.clear();
}
