/**
 * Émission des webhooks app→Hub (CONTRAT-HUB.md §7).
 *
 * Endpoint Hub : POST `${HUB_API_URL}/api/webhooks/prospection`
 * Auth : Bearer `HUB_WEBHOOK_TOKEN` (pattern C §6.3).
 *
 * Garantie : retry exponentiel (1s, 2s, 4s) sur 5xx ; pas de retry sur 4xx
 * (problème de spec, faut fix côté code). Si tous les retries échouent, on
 * log un erreur observable mais on ne bloque PAS la response API au Hub —
 * sinon un crash Hub casse les actions tenant côté app, ce qui est pire.
 *
 * Idempotency-Key : UUID v4 généré localement, passé dans le body. Le Hub
 * dédup sur cette clé (24h).
 *
 * En env test/dev (NODE_ENV=test ou HUB_WEBHOOK_DISABLE=1) : no-op silencieux
 * pour ne pas spam les hooks pendant les tests unitaires.
 */
import { randomUUID } from "crypto";

export type HubWebhookEvent =
  | "tenant.suspended"
  | "tenant.resumed"
  | "tenant.touched"
  | "tenant.owner_changed"
  | "tenant.quota_exceeded"
  // §5.18.4 — admin Prospection change le rôle ou visibility_scope d'un member
  | "tenant.member_role_changed";
// Plus d'écho des ordres du Hub (soft-delete, purge, ajout et retrait de membre, 27/11) : il en est la source.

/**
 * Version du contrat webhook §7.1 (CONTRAT-HUB.md). Inclus dans tous les
 * payloads sortants pour permettre au Hub de dispatcher vers le bon handler
 * (v1.4 vs legacy). Cf veridian-hub/lib/webhooks/prospection-handlers.ts.
 */
export const HUB_WEBHOOK_CONTRACT_VERSION = "1.4";

export interface HubWebhookPayload {
  event: HubWebhookEvent;
  tenant_id: string;
  occurred_at: string; // ISO8601
  data: Record<string, unknown>;
  idempotency_key: string;
  contract_version: typeof HUB_WEBHOOK_CONTRACT_VERSION;
}

const HUB_BASE_DELAY_MS = 1000;
const HUB_MAX_RETRIES = 3;

function getHubUrl(): string | null {
  return process.env.HUB_API_URL || null;
}
function getHubToken(): string | null {
  return process.env.HUB_WEBHOOK_TOKEN || null;
}
function isDisabled(): boolean {
  return (
    process.env.HUB_WEBHOOK_DISABLE === "1" ||
    process.env.NODE_ENV === "test"
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Émet un webhook au Hub. Retourne `true` si livré (200), `false` si tous
 * les retries ont échoué (le caller décide quoi faire — typiquement juste
 * logger, jamais bloquer l'action principale).
 */
export async function emitHubWebhook(
  event: HubWebhookEvent,
  tenantId: string,
  data: Record<string, unknown> = {},
): Promise<{ delivered: boolean; idempotency_key: string }> {
  const idempotencyKey = randomUUID();

  if (isDisabled()) {
    console.log(
      `[hub-webhook:noop] event=${event} tenant=${tenantId} idem=${idempotencyKey}`,
    );
    return { delivered: true, idempotency_key: idempotencyKey };
  }

  const url = getHubUrl();
  const token = getHubToken();
  if (!url || !token) {
    console.warn(
      `[hub-webhook:misconfigured] event=${event} tenant=${tenantId} url=${!!url} token=${!!token}`,
    );
    return { delivered: false, idempotency_key: idempotencyKey };
  }

  const payload: HubWebhookPayload = {
    event,
    tenant_id: tenantId,
    occurred_at: new Date().toISOString(),
    data,
    idempotency_key: idempotencyKey,
    contract_version: HUB_WEBHOOK_CONTRACT_VERSION,
  };

  const body = JSON.stringify(payload);
  const fullUrl = `${url.replace(/\/$/, "")}/api/webhooks/prospection`;

  for (let attempt = 0; attempt < HUB_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
      });

      if (res.ok) {
        console.log(
          `[hub-webhook:ok] event=${event} tenant=${tenantId} attempt=${attempt + 1} idem=${idempotencyKey}`,
        );
        return { delivered: true, idempotency_key: idempotencyKey };
      }

      // 4xx → bug de spec, on retry pas
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        console.error(
          `[hub-webhook:4xx] event=${event} tenant=${tenantId} status=${res.status} body=${text.slice(0, 200)}`,
        );
        return { delivered: false, idempotency_key: idempotencyKey };
      }

      // 5xx → retry
      console.warn(
        `[hub-webhook:5xx] event=${event} tenant=${tenantId} attempt=${attempt + 1} status=${res.status}`,
      );
    } catch (err) {
      console.warn(
        `[hub-webhook:network] event=${event} tenant=${tenantId} attempt=${attempt + 1} err=${
          (err as Error).message
        }`,
      );
    }

    if (attempt < HUB_MAX_RETRIES - 1) {
      await sleep(HUB_BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }

  console.error(
    `[hub-webhook:failed-all] event=${event} tenant=${tenantId} idem=${idempotencyKey} after ${HUB_MAX_RETRIES} attempts`,
  );
  return { delivered: false, idempotency_key: idempotencyKey };
}

/**
 * Helper fire-and-forget — pour les hooks dans une route API qui ne doit
 * pas bloquer la response sur la livraison.
 */
export function emitHubWebhookAsync(
  event: HubWebhookEvent,
  tenantId: string,
  data: Record<string, unknown> = {},
): void {
  // Pas de await — on lance et on oublie. Une erreur de réseau ne casse
  // jamais l'action user.
  emitHubWebhook(event, tenantId, data).catch((err) => {
    console.error(`[hub-webhook:fire-forget-crashed]`, err);
  });
}
