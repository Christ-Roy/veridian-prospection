/**
 * Client sortant Prospection → Hub : `POST /api/billing/refill-leads/checkout-from-app`.
 *
 * Variante du `refill-client.ts` (qui appelle l'ancienne route session-gated
 * `/checkout`) pour la route HMAC v2.1 `/checkout-from-app` consommée par la
 * page native refill ICP (Prosp → Hub).
 *
 * Différences avec `refill-client.ts` :
 *  - Contract version 2.1 (vs 2.0 implicite)
 *  - Body inclut `plan` (Prosp envoie son plan local) — pas besoin de
 *    round-trip Hub→Prosp pour deviner.
 *  - Body inclut `filters_json` (optionnel) — propagé en metadata Stripe par
 *    le Hub puis re-injecté dans `credit-leads` au webhook.
 *  - success_url / cancel_url DOIVENT pointer sur Prosp (l'user reste dans
 *    sa propre app après paiement).
 *
 * Identique : HMAC Pattern A (timestamp + signature SHA256 sur
 * `${timestamp}.${rawBody}`), best-effort strict (jamais throw, retourne
 * `{ ok: false, reason }` que le caller traduit en UX).
 */
import { createHmac } from "crypto";
import type { PlanId } from "@/lib/billing/plans";
import type { RefillIcpFilters } from "@/lib/refill-icp/filters";

const DEFAULT_TIMEOUT_MS = 5000;

export type RefillFromAppCheckoutRequest = {
  tenantId: string;
  quantity: number;
  plan: PlanId;
  filters?: RefillIcpFilters;
  successUrl?: string;
  cancelUrl?: string;
};

export type RefillFromAppCheckoutSuccess = {
  ok: true;
  url: string;
  sessionId: string;
  amountCents: number;
  quantity: number;
  tier: string;
};

export type RefillFromAppCheckoutFailure = {
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

export type RefillFromAppCheckoutResult =
  | RefillFromAppCheckoutSuccess
  | RefillFromAppCheckoutFailure;

function getHubUrl(): string | null {
  return process.env.HUB_API_URL || null;
}

function getHubSecret(): string | null {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET || null;
}

/**
 * Crée une session Stripe Checkout one-shot refill leads via le Hub, en
 * propageant la configuration ICP (`filters`).
 *
 * @param params.tenantId   workspace cible (uuid tenant Hub).
 * @param params.quantity   nombre de leads commandés (1..MAX, validé Hub aussi).
 * @param params.plan       plan local Prosp ('freemium'|'pro'|'business') —
 *                          le Hub re-calcule le prix à partir de ce tier.
 * @param params.filters    config ICP optionnelle, transmise en metadata Stripe.
 * @param params.successUrl URL ABSOLUE de redirection après paiement (Prosp).
 * @param params.cancelUrl  URL ABSOLUE de redirection après annulation (Prosp).
 * @param opts.timeoutMs    timeout custom (default 5000ms).
 */
export async function createRefillCheckoutFromApp(
  params: RefillFromAppCheckoutRequest,
  opts: { timeoutMs?: number } = {},
): Promise<RefillFromAppCheckoutResult> {
  const url = getHubUrl();
  const secret = getHubSecret();
  if (!url || !secret) {
    return { ok: false, reason: "hub_misconfigured" };
  }

  // Body camelCase pour TS — le Hub attend snake_case côté wire.
  const body = JSON.stringify({
    tenant_id: params.tenantId,
    quantity: params.quantity,
    plan: params.plan,
    ...(params.filters ? { filters_json: params.filters } : {}),
    ...(params.successUrl ? { success_url: params.successUrl } : {}),
    ...(params.cancelUrl ? { cancel_url: params.cancelUrl } : {}),
    contract_version: "2.1",
  });

  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const fullUrl = `${url.replace(/\/$/, "")}/api/billing/refill-leads/checkout-from-app`;

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
        `[refill-from-app-client] hub 4xx status=${res.status} body=${text.slice(0, 200)}`,
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
    if (
      typeof obj.url !== "string" ||
      typeof obj.sessionId !== "string" ||
      typeof obj.amount_cents !== "number"
    ) {
      return { ok: false, reason: "hub_invalid_response" };
    }
    return {
      ok: true,
      url: obj.url,
      sessionId: obj.sessionId,
      amountCents: obj.amount_cents,
      quantity: typeof obj.quantity === "number" ? obj.quantity : params.quantity,
      tier: typeof obj.tier === "string" ? obj.tier : params.plan,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { ok: false, reason: "hub_timeout" };
    }
    console.warn(
      `[refill-from-app-client] network err=${(err as Error).message}`,
    );
    return {
      ok: false,
      reason: "hub_network",
      message: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
