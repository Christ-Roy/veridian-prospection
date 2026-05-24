/**
 * Client sortant Prospection → Hub : `POST /api/billing/refill-leads/checkout`.
 *
 * Le Hub est SEUL maître Stripe (CONTRAT-BILLING.md §8.4) : Prospection ne
 * crée jamais de session Checkout localement. Cette fonction lui délègue la
 * création de la session, reçoit l'URL Stripe Checkout, et le caller
 * (route /api/billing/refill-checkout) renvoie au client qui sera redirigé.
 *
 * String canonique HMAC sortant identique aux autres clients (cf
 * `discovery-client.ts`) :
 *
 *     `${timestamp}.${rawBody}`
 *
 * Header signature : `X-Veridian-Hub-Signature: <hex hmac_sha256(secret, sig)>`.
 *
 * Best-effort strict : un Hub down OU un secret manquant retourne `{ ok:
 * false, reason }` au lieu de throw — la route caller décidera de l'UX
 * (500 + message clair).
 */
import { createHmac } from "crypto";

const DEFAULT_TIMEOUT_MS = 5000;

export type RefillCheckoutRequest = {
  tenantId: string;
  quantity: number;
  successUrl?: string;
  cancelUrl?: string;
};

export type RefillCheckoutSuccess = {
  ok: true;
  url: string;
  sessionId: string;
};

export type RefillCheckoutFailure = {
  ok: false;
  reason:
    | "hub_misconfigured"
    | "hub_timeout"
    | "hub_network"
    | "hub_unauthorized"
    | "hub_bad_request"
    | "hub_server_error"
    | "hub_invalid_response";
  status?: number;
  message?: string;
};

export type RefillCheckoutResult = RefillCheckoutSuccess | RefillCheckoutFailure;

function getHubUrl(): string | null {
  return process.env.HUB_API_URL || null;
}

function getHubSecret(): string | null {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET || null;
}

/**
 * Crée une session Stripe Checkout one-shot refill leads via le Hub.
 *
 * Délègue au Hub pour :
 *  - résolution du Stripe Customer (le Hub a la table users → customer_id)
 *  - calcul du prix faisant autorité (anti-tampering — on envoie quantity,
 *    le Hub re-calcule depuis tenant.plan + grille canonique)
 *  - création de la Session Stripe avec metadata routante (kind=refill_leads)
 *
 * @param params.tenantId   workspace cible (uuid tenant)
 * @param params.quantity   nombre de leads commandés (1..MAX, validé Hub aussi)
 * @param params.successUrl  redirect post-paiement (default : Hub décide)
 * @param params.cancelUrl   redirect si user annule (default : Hub décide)
 * @param opts.timeoutMs    timeout custom (default 5000ms — Stripe peut être lent)
 */
export async function createRefillCheckout(
  params: RefillCheckoutRequest,
  opts: { timeoutMs?: number } = {},
): Promise<RefillCheckoutResult> {
  const url = getHubUrl();
  const secret = getHubSecret();
  if (!url || !secret) {
    return { ok: false, reason: "hub_misconfigured" };
  }

  const body = JSON.stringify({
    tenantId: params.tenantId,
    quantity: params.quantity,
    ...(params.successUrl ? { successUrl: params.successUrl } : {}),
    ...(params.cancelUrl ? { cancelUrl: params.cancelUrl } : {}),
  });

  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const fullUrl = `${url.replace(/\/$/, "")}/api/billing/refill-leads/checkout`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-veridian-app": "prospection",
        "x-veridian-timestamp": String(timestamp),
        "x-veridian-hub-signature": signature,
      },
      body,
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "hub_unauthorized", status: res.status };
    }
    if (res.status >= 400 && res.status < 500) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[refill-client] hub 4xx status=${res.status} body=${text.slice(0, 200)}`,
      );
      return {
        ok: false,
        reason: "hub_bad_request",
        status: res.status,
        message: text.slice(0, 200),
      };
    }
    if (res.status >= 500) {
      return { ok: false, reason: "hub_server_error", status: res.status };
    }

    const data = (await res.json().catch(() => null)) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, reason: "hub_invalid_response" };
    }
    const obj = data as Record<string, unknown>;
    if (typeof obj.url !== "string" || typeof obj.sessionId !== "string") {
      return { ok: false, reason: "hub_invalid_response" };
    }
    return { ok: true, url: obj.url, sessionId: obj.sessionId };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { ok: false, reason: "hub_timeout" };
    }
    console.warn(`[refill-client] network err=${(err as Error).message}`);
    return { ok: false, reason: "hub_network", message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
