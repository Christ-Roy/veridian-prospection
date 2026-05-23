/**
 * Tests pour src/lib/hub/webhooks.ts (CONTRAT-HUB.md §7).
 *
 * Couvre :
 *  - no-op en NODE_ENV=test (default des tests) → delivered=true safe
 *  - no-op si HUB_API_URL absent → warn + delivered=false
 *  - 200 OK → delivered=true au premier essai
 *  - 4xx → pas de retry, delivered=false
 *  - 5xx → retry 3× avec backoff exponentiel, fail final → delivered=false
 *  - 5xx puis 200 → succès au 2e essai
 *  - network error → retry comme 5xx
 *  - idempotency_key est un UUID v4 stable dans la même livraison
 *  - payload bien formé (event, tenant_id, occurred_at, data, idempotency_key)
 *  - Bearer header présent + URL correctement assemblée
 *  - emitHubWebhookAsync ne throw jamais (fire-and-forget)
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  // On désactive le no-op test pour pouvoir exercer fetch
  (process.env as Record<string, string>).NODE_ENV = "production";
  process.env.HUB_WEBHOOK_DISABLE = "0";
});

import { emitHubWebhook, emitHubWebhookAsync } from "@/lib/hub/webhooks";

const ORIGINAL_FETCH = global.fetch;

function mockFetchOk() {
  const fn = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchStatus(...statuses: number[]) {
  const fn = vi.fn();
  for (const s of statuses) {
    fn.mockResolvedValueOnce(new Response(null, { status: s }));
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFetchReject(...errs: string[]) {
  const fn = vi.fn();
  for (const e of errs) {
    fn.mockRejectedValueOnce(new Error(e));
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("emitHubWebhook — happy path", () => {
  beforeEach(() => {
    process.env.HUB_API_URL = "https://hub.test.veridian.site";
    process.env.HUB_WEBHOOK_TOKEN = "test-webhook-token";
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test("200 OK → delivered=true au premier essai", async () => {
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.suspended", "t-1", {
      reason: "billing_past_due",
    });
    expect(r.delivered).toBe(true);
    expect(r.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hub.test.veridian.site/api/webhooks/prospection");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer test-webhook-token",
    );

    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("tenant.suspended");
    expect(body.tenant_id).toBe("t-1");
    expect(body.data.reason).toBe("billing_past_due");
    expect(body.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.idempotency_key).toBe(r.idempotency_key);
  });

  test("trailing slash sur HUB_API_URL est géré proprement", async () => {
    process.env.HUB_API_URL = "https://hub.test.veridian.site/";
    const fetchMock = mockFetchOk();
    await emitHubWebhook("tenant.resumed", "t-1");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://hub.test.veridian.site/api/webhooks/prospection",
    );
  });
});

describe("emitHubWebhook — retry behavior", () => {
  beforeEach(() => {
    process.env.HUB_API_URL = "https://hub.test.veridian.site";
    process.env.HUB_WEBHOOK_TOKEN = "test-webhook-token";
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
    vi.useFakeTimers();
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
  });

  test("4xx → pas de retry, delivered=false", async () => {
    const fetchMock = mockFetchStatus(400);
    const p = emitHubWebhook("tenant.suspended", "t-1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("5xx 3× → retry × 3 puis delivered=false", async () => {
    const fetchMock = mockFetchStatus(503, 503, 503);
    const p = emitHubWebhook("tenant.deleted", "t-1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("5xx puis 200 → succès au 2e essai", async () => {
    const fetchMock = mockFetchStatus(503, 200);
    const p = emitHubWebhook("tenant.touched", "t-1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("network error → retry comme 5xx, fail si tout casse", async () => {
    const fetchMock = mockFetchReject("ECONNREFUSED", "ETIMEDOUT", "EHOSTDOWN");
    const p = emitHubWebhook("tenant.suspended", "t-1");
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("emitHubWebhook — config absente", () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test("no-op + delivered=true si HUB_WEBHOOK_DISABLE=1", async () => {
    process.env.HUB_WEBHOOK_DISABLE = "1";
    (process.env as Record<string, string>).NODE_ENV = "production";
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.suspended", "t-1");
    expect(r.delivered).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("no-op + delivered=true si NODE_ENV=test (default)", async () => {
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "test";
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.resumed", "t-1");
    expect(r.delivered).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    (process.env as Record<string, string>).NODE_ENV = "production";
  });

  test("delivered=false si HUB_API_URL absent", async () => {
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.HUB_API_URL;
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.suspended", "t-1");
    expect(r.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("delivered=false si HUB_WEBHOOK_TOKEN absent", async () => {
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.HUB_API_URL = "https://hub.test.veridian.site";
    delete process.env.HUB_WEBHOOK_TOKEN;
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.suspended", "t-1");
    expect(r.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("emitHubWebhookAsync", () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test("ne throw jamais même si fetch crash", async () => {
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.HUB_API_URL = "https://hub.test.veridian.site";
    process.env.HUB_WEBHOOK_TOKEN = "t";
    global.fetch = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    // Doit retourner void sans throw
    expect(() => emitHubWebhookAsync("tenant.suspended", "t-1")).not.toThrow();
    // Petit délai pour laisser le .catch() s'exécuter
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("HubWebhookEvent — événements §5.18.4", () => {
  beforeEach(() => {
    process.env.HUB_API_URL = "https://hub.test.veridian.site";
    process.env.HUB_WEBHOOK_TOKEN = "test-webhook-token";
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test("tenant.member_role_changed est un event accepté + payload transmis", async () => {
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.member_role_changed", "t-1", {
      user_email: "bob@example.com",
      old_role: "member",
      new_role: "admin",
      workspace_id: "ws-1",
      visibility_scope: "own",
      changed_by: "admin@example.com",
    });
    expect(r.delivered).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("tenant.member_role_changed");
    expect(body.data.old_role).toBe("member");
    expect(body.data.new_role).toBe("admin");
    expect(body.data.visibility_scope).toBe("own");
  });
});

describe("HubWebhookEvent — §7.1 v1.4 Niveau 2 sync", () => {
  beforeEach(() => {
    process.env.HUB_API_URL = "https://hub.test.veridian.site";
    process.env.HUB_WEBHOOK_TOKEN = "test-webhook-token";
    process.env.HUB_WEBHOOK_DISABLE = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test("payload inclut contract_version='1.4'", async () => {
    const fetchMock = mockFetchOk();
    await emitHubWebhook("tenant.suspended", "t-1", { reason: "billing" });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.contract_version).toBe("1.4");
  });

  test("tenant.soft_deleted accepté + payload data", async () => {
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.soft_deleted", "t-1", {
      soft_deleted_at: "2026-05-23T10:00:00.000Z",
      purge_eligible_at: "2026-06-22T10:00:00.000Z",
      reason: "user_requested",
    });
    expect(r.delivered).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("tenant.soft_deleted");
    expect(body.data.reason).toBe("user_requested");
  });

  test("tenant.purged accepté + payload rows_deleted", async () => {
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.purged", "t-1", {
      purged_at: "2026-06-22T10:00:00.000Z",
      rows_deleted: { prospects: 12_400, leads: 3_300 },
      reason: "grace_period_expired",
    });
    expect(r.delivered).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("tenant.purged");
    expect(body.data.rows_deleted).toEqual({ prospects: 12_400, leads: 3_300 });
  });

  test("tenant.member_added accepté", async () => {
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.member_added", "t-1", {
      workspace_id: "ws-1",
      user_id: "u-1",
      hub_user_id: "hub-u-1",
      email: "bob@example.com",
      role: "member",
      action: "created",
    });
    expect(r.delivered).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("tenant.member_added");
    expect(body.data.role).toBe("member");
  });

  test("tenant.member_removed accepté", async () => {
    const fetchMock = mockFetchOk();
    const r = await emitHubWebhook("tenant.member_removed", "t-1", {
      user_id: "u-1",
      email: "bob@example.com",
      affected_workspaces: 2,
    });
    expect(r.delivered).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.event).toBe("tenant.member_removed");
    expect(body.data.affected_workspaces).toBe(2);
  });
});
