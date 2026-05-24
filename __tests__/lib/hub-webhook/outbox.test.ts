/**
 * Tests src/lib/hub-webhook/outbox.ts (pattern transactional outbox).
 *
 * Couvre :
 *  - enqueueEvent : INSERT outbox via le `tx` reçu (atomicité), payload bien
 *    formé (event/tenant_id/data/idempotency_key/contract_version).
 *  - nextRetryDelayMs : backoff exponentiel, cap 1h.
 *  - processOutbox : SELECT FOR UPDATE SKIP LOCKED → lock → envoi →
 *      - delivered → status='sent', sent_at, attempts++
 *      - failed retry → status='failed_retry', next_retry_at exp
 *      - dead letter → 10 attempts atteints → status='dead', sortie file
 *  - idempotency_key UNIQUE — l'INSERT duplicate violet une UNIQUE constraint
 *    (testé via le code Prisma error, P2002).
 *
 * Pas de DB réelle ici (tests unit, fast). L'intégration concurrence
 * SELECT FOR UPDATE SKIP LOCKED est testée par les e2e Playwright avec
 * postgres-staging réel.
 */
import { describe, expect, test, vi } from "vitest";
import {
  enqueueEvent,
  nextRetryDelayMs,
  processOutbox,
  MAX_OUTBOX_ATTEMPTS,
} from "@/lib/hub-webhook/outbox";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("nextRetryDelayMs — backoff exponentiel", () => {
  test("attempts=0 → 0ms (premier essai = NOW())", () => {
    expect(nextRetryDelayMs(0)).toBe(0);
  });

  test("attempts=1 → 1000ms", () => {
    expect(nextRetryDelayMs(1)).toBe(1_000);
  });

  test("attempts=2 → 2000ms", () => {
    expect(nextRetryDelayMs(2)).toBe(2_000);
  });

  test("attempts=3 → 4000ms", () => {
    expect(nextRetryDelayMs(3)).toBe(4_000);
  });

  test("attempts=6 → 32000ms", () => {
    expect(nextRetryDelayMs(6)).toBe(32_000);
  });

  test("attempts=20 → cap à 1h (3_600_000ms)", () => {
    // 2^19 * 1000 = 524_288_000ms → tronqué à 3_600_000 (1h)
    expect(nextRetryDelayMs(20)).toBe(3_600_000);
  });

  test("cap : tout attempts >= 22 retourne exactement 1h", () => {
    expect(nextRetryDelayMs(22)).toBe(3_600_000);
    expect(nextRetryDelayMs(100)).toBe(3_600_000);
  });
});

describe("enqueueEvent — INSERT outbox via tx (atomicité)", () => {
  test("appelle tx.webhookOutbox.create avec payload v1.4 bien formé", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "out-1",
      idempotencyKey: "idem-1",
    });
    const tx = { webhookOutbox: { create } } as unknown as Parameters<
      typeof enqueueEvent
    >[0];

    const result = await enqueueEvent(tx, "tenant.soft_deleted", TENANT_ID, {
      reason: "abuse",
    });

    expect(result.id).toBe("out-1");
    expect(result.idempotencyKey).toBe("idem-1");
    expect(create).toHaveBeenCalledOnce();

    const args = create.mock.calls[0][0];
    expect(args.data.eventType).toBe("tenant.soft_deleted");
    expect(args.data.tenantId).toBe(TENANT_ID);
    expect(args.data.status).toBe("pending");
    expect(args.data.attempts).toBe(0);
    // idempotency_key = UUID v4
    expect(args.data.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // payload contient tout le wire format Hub
    expect(args.data.payload.event).toBe("tenant.soft_deleted");
    expect(args.data.payload.tenant_id).toBe(TENANT_ID);
    expect(args.data.payload.contract_version).toBe("1.4");
    expect(args.data.payload.idempotency_key).toBe(args.data.idempotencyKey);
    expect(args.data.payload.data.reason).toBe("abuse");
    expect(args.data.payload.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("propage l'erreur Prisma (rollback de la transaction parente)", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
    const tx = { webhookOutbox: { create } } as unknown as Parameters<
      typeof enqueueEvent
    >[0];

    await expect(
      enqueueEvent(tx, "tenant.purged", TENANT_ID, {}),
    ).rejects.toThrow("Unique constraint failed");
  });

  test("data par défaut = {} si non fourni", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "out-2",
      idempotencyKey: "idem-2",
    });
    const tx = { webhookOutbox: { create } } as unknown as Parameters<
      typeof enqueueEvent
    >[0];

    await enqueueEvent(tx, "tenant.member_removed", TENANT_ID);
    const args = create.mock.calls[0][0];
    expect(args.data.payload.data).toEqual({});
  });
});

describe("processOutbox — worker loop", () => {
  function makeRow(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: over.id ?? "out-1",
      event_type: (over.event_type as string) ?? "tenant.soft_deleted",
      tenant_id: (over.tenant_id as string) ?? TENANT_ID,
      payload: over.payload ?? {
        event: "tenant.soft_deleted",
        tenant_id: TENANT_ID,
        data: { reason: "abuse" },
      },
      idempotency_key: (over.idempotency_key as string) ?? "idem-1",
      attempts: (over.attempts as number) ?? 0,
    };
  }

  function makePrismaMock(rows: ReturnType<typeof makeRow>[]) {
    const queryRawUnsafe = vi.fn().mockResolvedValue(rows);
    const updateMany = vi.fn().mockResolvedValue({ count: rows.length });
    const update = vi.fn().mockImplementation(async () => ({}));

    const txClient = {
      $queryRawUnsafe: queryRawUnsafe,
      webhookOutbox: { updateMany },
    };

    const client = {
      $transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: typeof txClient) => unknown) => {
          return cb(txClient);
        }),
      webhookOutbox: { update },
    };

    return { client, queryRawUnsafe, updateMany, update };
  }

  test("queue vide → picked=0, sent=0, pas d'update", async () => {
    const { client, queryRawUnsafe, updateMany, update } = makePrismaMock([]);

    const result = await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send: vi.fn(),
    });

    expect(result.picked).toBe(0);
    expect(result.sent).toBe(0);
    expect(queryRawUnsafe).toHaveBeenCalledOnce();
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("SELECT utilise FOR UPDATE SKIP LOCKED + filtre pending|failed_retry", async () => {
    const { client, queryRawUnsafe } = makePrismaMock([]);
    await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send: vi.fn(),
    });
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("status IN ('pending', 'failed_retry')");
    expect(sql).toContain("next_retry_at <= NOW()");
  });

  test("delivered=true → status='sent', sent_at posé, attempts++", async () => {
    const row = makeRow();
    const { client, update } = makePrismaMock([row]);

    const send = vi.fn().mockResolvedValue({ delivered: true });
    const result = await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send,
    });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.dead).toBe(0);
    expect(update).toHaveBeenCalledOnce();
    const updateArgs = update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe("out-1");
    expect(updateArgs.data.status).toBe("sent");
    expect(updateArgs.data.sentAt).toBeInstanceOf(Date);
    expect(updateArgs.data.attempts).toEqual({ increment: 1 });

    // send reçoit (event, tenantId, data, idempotency_key)
    expect(send).toHaveBeenCalledWith(
      "tenant.soft_deleted",
      TENANT_ID,
      { reason: "abuse" },
      "idem-1",
    );
  });

  test("delivered=false → status='failed_retry', next_retry_at exp", async () => {
    const row = makeRow({ attempts: 2 });
    const { client, update } = makePrismaMock([row]);

    const sendFail = vi
      .fn()
      .mockResolvedValue({ delivered: false, error: "http_503" });
    const result = await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send: sendFail,
    });

    expect(result.failed).toBe(1);
    expect(result.dead).toBe(0);
    const updateArgs = update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("failed_retry");
    expect(updateArgs.data.attempts).toBe(3);
    expect(updateArgs.data.lastError).toBe("http_503");
    // attempts = 3 (post-incr) → delay = 4000ms (2^(3-1) * 1s)
    const delay =
      (updateArgs.data.nextRetryAt as Date).getTime() - Date.now();
    expect(delay).toBeGreaterThan(3_500); // ~4000ms ± marge
    expect(delay).toBeLessThan(4_500);
  });

  test("dead letter — attempts >= MAX_OUTBOX_ATTEMPTS → status='dead'", async () => {
    // Row a déjà attempts=9. Le retry portera attempts à 10 = MAX → dead.
    const row = makeRow({ attempts: MAX_OUTBOX_ATTEMPTS - 1 });
    const { client, update } = makePrismaMock([row]);

    const sendFail = vi
      .fn()
      .mockResolvedValue({ delivered: false, error: "network_eof" });
    const result = await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send: sendFail,
    });

    expect(result.failed).toBe(0);
    expect(result.dead).toBe(1);
    const updateArgs = update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("dead");
    expect(updateArgs.data.attempts).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(updateArgs.data.lastError).toBe("network_eof");
    // Pas de next_retry_at sur dead — la row sort de la file.
    expect(updateArgs.data.nextRetryAt).toBeUndefined();
  });

  test("batch mixte — sent + failed + dead comptés indépendamment", async () => {
    const rows = [
      makeRow({ id: "ok", idempotency_key: "k-ok", attempts: 0 }),
      makeRow({ id: "fail", idempotency_key: "k-fail", attempts: 1 }),
      makeRow({
        id: "die",
        idempotency_key: "k-die",
        attempts: MAX_OUTBOX_ATTEMPTS - 1,
      }),
    ];
    const { client } = makePrismaMock(rows);

    const send = vi.fn().mockImplementation(async (_evt, _tid, _data, key) => {
      if (key === "k-ok") return { delivered: true };
      return { delivered: false, error: "boom" };
    });

    const result = await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send,
    });
    expect(result.picked).toBe(3);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dead).toBe(1);
  });

  test("verrouille les rows pickées via updateMany status='sending'", async () => {
    const row = makeRow();
    const { client, updateMany } = makePrismaMock([row]);

    await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send: vi.fn().mockResolvedValue({ delivered: true }),
    });

    expect(updateMany).toHaveBeenCalledOnce();
    const args = updateMany.mock.calls[0][0];
    expect(args.where.id.in).toEqual(["out-1"]);
    expect(args.data.status).toBe("sending");
  });

  test("idempotency_key réutilisé sur retry — payload.data réémis tel quel", async () => {
    // Garantie : si Hub a déjà reçu (dédup 24h), notre retry porte le même
    // key, donc Hub renvoie 200 deduplicated et notre processOutbox marque
    // sent sans re-jouer la mutation côté Hub.
    const row = makeRow({
      idempotency_key: "stable-key-xyz",
      payload: {
        event: "tenant.member_removed",
        tenant_id: TENANT_ID,
        data: { user_id: "u-1", affected_workspaces: 2 },
      },
    });
    const { client } = makePrismaMock([row]);

    const send = vi.fn().mockResolvedValue({ delivered: true });
    await processOutbox({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: client as any,
      send,
    });

    // Le `send` injecté reçoit le key tel quel — c'est ce qui assure que
    // le Hub dédup sur la même clé entre retry.
    expect(send.mock.calls[0][3]).toBe("stable-key-xyz");
    expect(send.mock.calls[0][2]).toEqual({
      user_id: "u-1",
      affected_workspaces: 2,
    });
  });
});

describe("MAX_OUTBOX_ATTEMPTS — sanité", () => {
  test("vaut 10 (ticket §Plan d'implémentation item 4)", () => {
    expect(MAX_OUTBOX_ATTEMPTS).toBe(10);
  });
});
