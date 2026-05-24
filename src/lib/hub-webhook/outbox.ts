/**
 * Pattern transactional outbox pour webhooks Prospection → Hub.
 *
 * Cf migration 0023_add_webhook_outbox + CONTRAT-HUB.md §7.1.
 *
 * Deux faces :
 *
 *  - `enqueueEvent(tx, event, tenantId, data)` : INSERT outbox dans la MÊME
 *    transaction Prisma que la mutation métier. Garantit que si la mutation
 *    rollback, l'event aussi. Appelé depuis les routes mutantes.
 *
 *  - `processOutbox(opts?)` : SELECT FOR UPDATE SKIP LOCKED des rows
 *    pending/failed_retry échues, envoi via `emitHubWebhook` legacy, UPDATE
 *    status → sent / failed_retry / dead. Appelé par le cron
 *    `/api/cron/process-outbox`.
 *
 * Backoff exponentiel : 1s, 2s, 4s, 8s, 16s, ..., cap 1h. Après 10 attempts
 * → `dead` (sortie de la file, alerte ops). Le Hub dédup déjà sur
 * idempotency_key 24h donc retry d'un event déjà reçu = 200 no-op.
 *
 * Concurrence : `SELECT FOR UPDATE SKIP LOCKED` permet N workers en parallèle
 * sans double-envoi. Implémenté en raw SQL parce que Prisma n'expose pas
 * FOR UPDATE natif (pattern Postgres standard pour les queues légères).
 */
import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  HUB_WEBHOOK_CONTRACT_VERSION,
  emitHubWebhook,
  type HubWebhookEvent,
} from "@/lib/hub/webhooks";

// Backoff exponentiel cap à 1h (60 * 60 * 1000 ms). Base 1s.
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60 * 60 * 1_000;

// Au-delà de cette limite, l'event passe en `dead` et n'est plus retenté.
// 10 tentatives × backoff exponentiel ≈ 1s + 2s + 4s + 8s + 16s + 32s + 64s
// + 128s + 256s + 512s ≈ 17 min en cumul avant les caps 1h. Largement
// suffisant pour absorber une indispo Hub courte sans inonder l'API quand
// le Hub est durablement HS.
export const MAX_OUTBOX_ATTEMPTS = 10;

// Combien d'events un appel `processOutbox` consomme par tick. Petit volume
// estimé (<100 events/jour à terme), garder bas pour éviter les locks longs.
const DEFAULT_BATCH_SIZE = 50;

/**
 * Type minimal couvrant à la fois `PrismaClient` et le client transactionnel
 * exposé par `prisma.$transaction(async (tx) => ...)`. On évite d'importer
 * `Prisma.TransactionClient` direct pour ne pas dépendre d'un alias qui
 * bouge entre versions Prisma.
 */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface EnqueueResult {
  id: string;
  idempotencyKey: string;
}

/**
 * Calcule le `next_retry_at` à partir du nombre de tentatives effectuées.
 * `attempts` = nombre d'essais déjà comptabilisés (1 après le premier échec).
 * Retour : Date dans le futur (ou maintenant si attempts=0).
 */
export function nextRetryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const delay = BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
  return Math.min(delay, BACKOFF_CAP_MS);
}

/**
 * INSERT un event dans `webhook_outbox`. À appeler dans une `$transaction`
 * Prisma avec la mutation métier en amont — atomicité garantie.
 *
 * Signature volontairement similaire à `emitHubWebhookAsync` pour faciliter
 * la migration des 4 routes existantes (cf ticket §"Plan d'implémentation").
 *
 * @param tx       Le client Prisma (ou tx.$transaction client) qui détient
 *                 la transaction métier. CRITIQUE : passer la même instance
 *                 que celle utilisée pour la mutation, sinon pas d'atomicité.
 * @param event    Event v1.4 (cf HubWebhookEvent).
 * @param tenantId UUID du tenant concerné.
 * @param data     Payload métier (sérialisable JSON).
 */
export async function enqueueEvent(
  tx: PrismaLike,
  event: HubWebhookEvent,
  tenantId: string,
  data: Record<string, unknown> = {},
): Promise<EnqueueResult> {
  const idempotencyKey = randomUUID();

  // On stocke le payload complet (event, tenant_id, occurred_at, data,
  // contract_version) tel qu'il sera envoyé au Hub. Le worker lit cette
  // colonne pour reconstituer la requête sortante.
  const payload = {
    event,
    tenant_id: tenantId,
    occurred_at: new Date().toISOString(),
    data,
    idempotency_key: idempotencyKey,
    contract_version: HUB_WEBHOOK_CONTRACT_VERSION,
  };

  const row = await tx.webhookOutbox.create({
    data: {
      eventType: event,
      tenantId,
      // Prisma `Json` exige `InputJsonValue` strict — `data` est typé
      // `Record<string, unknown>` ici car on accepte n'importe quel payload
      // métier sérialisable. Le caller garantit la sérialisabilité via la
      // signature `Record<string, unknown>` qui ne tolère pas Symbol/Function.
      payload: payload as unknown as Prisma.InputJsonValue,
      idempotencyKey,
      status: "pending",
      attempts: 0,
    },
    select: { id: true, idempotencyKey: true },
  });

  return { id: row.id, idempotencyKey: row.idempotencyKey };
}

export interface ProcessOutboxResult {
  picked: number;
  sent: number;
  failed: number;
  dead: number;
}

export interface ProcessOutboxOptions {
  /** Max rows à consommer par appel. Default 50. */
  batchSize?: number;
  /** Prisma client à utiliser. Default = singleton. Override pour les tests. */
  prisma?: PrismaClient;
  /**
   * Override de la fonction d'envoi (DI pour tests sans monkeypatch global).
   * Retourne `{ delivered }` comme `emitHubWebhook`.
   */
  send?: (
    event: HubWebhookEvent,
    tenantId: string,
    data: Record<string, unknown>,
    idempotencyKey: string,
  ) => Promise<{ delivered: boolean; error?: string }>;
}

interface OutboxRowRaw {
  id: string;
  event_type: string;
  tenant_id: string;
  payload: unknown;
  idempotency_key: string;
  attempts: number;
}

/**
 * Worker : consomme un batch d'events éligibles et tente de les pousser
 * au Hub. Idempotent et concurrence-safe (SELECT FOR UPDATE SKIP LOCKED).
 *
 * Appelé depuis le cron `/api/cron/process-outbox` (toutes les 1-5 min en prod).
 *
 * Pattern d'erreur :
 *  - delivered=true        → status='sent', sent_at=NOW()
 *  - delivered=false       → attempts++, status='failed_retry' OR 'dead',
 *                            next_retry_at calculé via nextRetryDelayMs()
 */
export async function processOutbox(
  opts: ProcessOutboxOptions = {},
): Promise<ProcessOutboxResult> {
  const client = opts.prisma ?? (defaultPrisma as PrismaClient);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const send =
    opts.send ??
    (async (event, tenantId, data, idempotencyKey) => {
      // emitHubWebhook génère lui-même son idempotency_key. On veut
      // réutiliser celui de l'outbox row (sinon le Hub dédup ne tient
      // pas entre retry). On passe donc en raw fetch ici pour avoir le
      // contrôle complet du payload.
      return rawSendHubWebhook(event, tenantId, data, idempotencyKey);
    });

  const result: ProcessOutboxResult = {
    picked: 0,
    sent: 0,
    failed: 0,
    dead: 0,
  };

  // Lock concurrent-safe : SELECT FOR UPDATE SKIP LOCKED. Postgres garantit
  // qu'un worker B ne reverra pas les rows déjà locked par A. On fait UPDATE
  // status='sending' dans la même transaction pour signaler aux autres
  // workers que ces rows sont prises (au cas où le SKIP LOCKED ne suffise
  // pas — cf Postgres docs "SKIP LOCKED" + isolation).
  const picked = await client.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<OutboxRowRaw[]>(
      `
        SELECT id, event_type, tenant_id, payload, idempotency_key, attempts
        FROM webhook_outbox
        WHERE status IN ('pending', 'failed_retry')
          AND next_retry_at <= NOW()
        ORDER BY next_retry_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
      batchSize,
    );

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx.webhookOutbox.updateMany({
      where: { id: { in: ids } },
      data: { status: "sending" },
    });

    return rows;
  });

  result.picked = picked.length;
  if (picked.length === 0) return result;

  // Envoi hors transaction (sinon HTTP bloque le lock). Chaque row a son
  // propre cycle d'update.
  for (const row of picked) {
    const data = extractData(row.payload);
    const attempt = await send(
      row.event_type as HubWebhookEvent,
      row.tenant_id,
      data,
      row.idempotency_key,
    );

    if (attempt.delivered) {
      await client.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      result.sent++;
      continue;
    }

    const nextAttempts = row.attempts + 1;
    if (nextAttempts >= MAX_OUTBOX_ATTEMPTS) {
      await client.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: "dead",
          attempts: nextAttempts,
          lastError: attempt.error ?? "max_attempts_reached",
        },
      });
      result.dead++;
      console.error(
        `[outbox:dead] event=${row.event_type} tenant=${row.tenant_id} id=${row.id} attempts=${nextAttempts}`,
      );
    } else {
      const delay = nextRetryDelayMs(nextAttempts);
      await client.webhookOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed_retry",
          attempts: nextAttempts,
          nextRetryAt: new Date(Date.now() + delay),
          lastError: attempt.error ?? "delivery_failed",
        },
      });
      result.failed++;
    }
  }

  return result;
}

/**
 * Envoi raw au Hub avec idempotency_key fourni (vs emitHubWebhook qui
 * génère le sien). Réutilise les ENV du module legacy.
 */
async function rawSendHubWebhook(
  event: HubWebhookEvent,
  tenantId: string,
  data: Record<string, unknown>,
  idempotencyKey: string,
): Promise<{ delivered: boolean; error?: string }> {
  // En env test, on délègue à `emitHubWebhook` qui no-op proprement (et qui
  // est déjà couvert par 12 tests Vitest). Mais on transmet le idempotency_key
  // existant via la signature… qui ne l'expose pas. Solution simple : on
  // re-pose l'absence d'effet ici en test, et on garde fetch réel en prod.
  if (
    process.env.HUB_WEBHOOK_DISABLE === "1" ||
    process.env.NODE_ENV === "test"
  ) {
    return { delivered: true };
  }

  const url = process.env.HUB_API_URL;
  const token = process.env.HUB_WEBHOOK_TOKEN;
  if (!url || !token) {
    return { delivered: false, error: "hub_not_configured" };
  }

  const fullUrl = `${url.replace(/\/$/, "")}/api/webhooks/prospection`;
  const body = JSON.stringify({
    event,
    tenant_id: tenantId,
    occurred_at: new Date().toISOString(),
    data,
    idempotency_key: idempotencyKey,
    contract_version: HUB_WEBHOOK_CONTRACT_VERSION,
  });

  try {
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    if (res.ok) return { delivered: true };

    // 4xx → bug spec, marque comme failed sans retry agressif (mais on
    // garde le retry pour absorber un déploiement bancal côté Hub qui
    // se résout en quelques minutes). 5xx → retry standard.
    const text = await res.text().catch(() => "");
    return {
      delivered: false,
      error: `http_${res.status}: ${text.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      delivered: false,
      error: `network: ${(err as Error).message}`,
    };
  }
}

function extractData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  if (p.data && typeof p.data === "object") {
    return p.data as Record<string, unknown>;
  }
  return {};
}

// Re-export pour ergonomie côté routes appelantes.
export { emitHubWebhook };
