/**
 * Client sortant Prospection → Hub : `GET /api/users/by-email`.
 *
 * Pattern Discovery cross-app (cf. ticket
 * 2026-05-23-call-hub-discovery-by-email.md) : au login d'un user, on
 * interroge le Hub pour savoir s'il a déjà d'autres apps actives. Ça permet
 * de proposer un menu "tu as plusieurs apps, va au Hub" et de pré-charger
 * les liens cross-app dans le dashboard.
 *
 * Best-effort strict : un échec (Hub down, timeout, HMAC désynchro, secret
 * absent en local) ne doit JAMAIS bloquer le login Prospection. La fonction
 * retourne toujours soit le résultat parsé, soit `null`.
 *
 * String canonique du contrat HMAC sortant (cf. helper côté Hub
 * `lib/discovery/hmac.ts` et endpoint local
 * `src/app/api/users/by-email/route.ts` ligne 56-58) :
 *
 *   `${timestamp}.` (point final, rawBody == "" pour un GET sans body)
 *
 * Header signature : `X-Veridian-Hub-Signature: <hex hmac_sha256(secret, sig)>`.
 */
import { createHmac } from "crypto";

const DEFAULT_TIMEOUT_MS = 2000;

export type DiscoveryWorkspace = {
  workspace_id: string;
  workspace_name: string;
  role: string;
  plan: string;
  status: "active" | "suspended" | "deleted";
  magic_link_capable: boolean;
  fallback_url: string;
};

export type DiscoveryResult =
  | { found: true; user_email: string; workspaces: DiscoveryWorkspace[] }
  | { found: false };

/**
 * Interroge le Hub pour les apps connues d'un email. Retourne `null` sur
 * toute erreur (réseau, timeout, 4xx/5xx, parsing). N'émet jamais
 * d'exception non-attrapée.
 *
 * @param email Email du user qui vient de se logger (sera URL-encodé).
 * @param opts.timeoutMs Timeout custom (default 2000ms).
 */
export async function fetchHubDiscovery(
  email: string,
  opts: { timeoutMs?: number } = {},
): Promise<DiscoveryResult | null> {
  const url = process.env.HUB_API_URL;
  const secret = process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;

  if (!url || !secret) {
    return null;
  }

  // Normalisation email — l'endpoint Hub fait .trim().toLowerCase()
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const timestamp = Date.now();
  // GET : pas de body. La signature porte sur `${ts}.` (string canonique
  // cross-app — symétrique à src/app/api/users/by-email/route.ts:56-58).
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .digest("hex");

  const fullUrl = `${url.replace(/\/$/, "")}/api/users/by-email?email=${encodeURIComponent(
    normalized,
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "x-veridian-app": "prospection",
        "x-veridian-timestamp": String(timestamp),
        "x-veridian-hub-signature": signature,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(
        `[hub-discovery] non-ok status=${res.status} email=${normalized.slice(0, 4)}***`,
      );
      return null;
    }

    const data = (await res.json().catch(() => null)) as unknown;
    if (!data || typeof data !== "object") return null;

    const obj = data as Record<string, unknown>;
    if (obj.found === false) return { found: false };
    if (
      obj.found === true &&
      typeof obj.user_email === "string" &&
      Array.isArray(obj.workspaces)
    ) {
      return {
        found: true,
        user_email: obj.user_email,
        workspaces: obj.workspaces as DiscoveryWorkspace[],
      };
    }
    return null;
  } catch (err) {
    const msg = (err as Error).message;
    if ((err as Error).name === "AbortError") {
      console.warn(`[hub-discovery] timeout email=${normalized.slice(0, 4)}***`);
    } else {
      console.warn(
        `[hub-discovery] error email=${normalized.slice(0, 4)}*** err=${msg}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
