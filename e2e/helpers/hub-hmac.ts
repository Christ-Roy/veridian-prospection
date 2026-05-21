/**
 * Helper HMAC Hub — simule un appel signé du Hub vers Prospection
 * pour les specs e2e qui couvrent les routes contrat §5.
 *
 * Format de signature (cf src/lib/hub/hmac.ts) :
 *   X-Veridian-Timestamp: <unix_ms>
 *   X-Veridian-Hub-Signature: hex(hmac_sha256(secret, `${ts}.${rawBody}`))
 *
 * Le secret est lu depuis HUB_API_SECRET ou TENANT_API_SECRET (même fallback
 * que requireHubHmac côté server). Sur staging la valeur par défaut
 * `staging-prospection-secret-2026` est partagée par convention.
 */
import { createHmac } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";

export const HUB_SECRET =
  process.env.HUB_API_SECRET ||
  process.env.TENANT_API_SECRET ||
  "staging-prospection-secret-2026";

export function signHubBody(rawBody: string, secret = HUB_SECRET): {
  timestamp: string;
  signature: string;
} {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return { timestamp, signature };
}

export function hubHmacHeaders(rawBody: string, secret = HUB_SECRET): Record<string, string> {
  const { timestamp, signature } = signHubBody(rawBody, secret);
  return {
    "Content-Type": "application/json",
    "X-Veridian-Timestamp": timestamp,
    "X-Veridian-Hub-Signature": signature,
  };
}

/** POST signé Hub. Le body est passé tel quel (déjà sérialisé en string). */
export function hubPost(
  request: APIRequestContext,
  url: string,
  body: unknown,
  secret = HUB_SECRET,
): Promise<APIResponse> {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  return request.post(url, {
    headers: hubHmacHeaders(rawBody, secret),
    data: rawBody,
  });
}

/** GET signé Hub (body vide). */
export function hubGet(
  request: APIRequestContext,
  url: string,
  secret = HUB_SECRET,
): Promise<APIResponse> {
  return request.get(url, {
    headers: hubHmacHeaders("", secret),
  });
}
