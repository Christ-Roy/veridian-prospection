/**
 * Tests POST /api/cron/mail-outbox-flush.
 *
 * Couvre :
 *  - 503 si CRON_SECRET non configuré
 *  - 401 sans Authorization / Bearer wrong
 *  - 200 + résultats flushOutbox quand auth OK
 *  - 500 + ok=false si flushOutbox throw
 *  - Bearer case-insensitive (proxies lowercase)
 *
 * Aligné avec le pattern process-outbox.test.ts.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { flushOutboxMock } = vi.hoisted(() => ({
  flushOutboxMock: vi.fn(),
}));

vi.mock("@/lib/mail/outbox", () => ({
  flushOutbox: flushOutboxMock,
}));

import { POST } from "@/app/api/cron/mail-outbox-flush/route";
import { makeRequest, readJson } from "../_helpers";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret-mail";
});

describe("POST /api/cron/mail-outbox-flush", () => {
  test("503 si CRON_SECRET non configuré", async () => {
    delete process.env.CRON_SECRET;
    const r = makeRequest("/api/cron/mail-outbox-flush", { method: "POST" });
    const res = await POST(r);
    expect(res.status).toBe(503);
    expect(flushOutboxMock).not.toHaveBeenCalled();
  });

  test("401 sans header Authorization", async () => {
    const r = makeRequest("/api/cron/mail-outbox-flush", { method: "POST" });
    const res = await POST(r);
    expect(res.status).toBe(401);
    expect(flushOutboxMock).not.toHaveBeenCalled();
  });

  test("401 si Bearer ne match pas le secret", async () => {
    const r = makeRequest("/api/cron/mail-outbox-flush", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
    expect(flushOutboxMock).not.toHaveBeenCalled();
  });

  test("401 si schéma autre que Bearer", async () => {
    const r = makeRequest("/api/cron/mail-outbox-flush", {
      method: "POST",
      headers: { authorization: "Basic dGVzdA==" },
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
  });

  test("200 + résultats flushOutbox quand auth OK", async () => {
    flushOutboxMock.mockResolvedValueOnce({
      picked: 5,
      sent: 3,
      failedRetry: 1,
      failed: 1,
    });
    const r = makeRequest("/api/cron/mail-outbox-flush", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret-mail" },
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      ok: boolean;
      picked: number;
      sent: number;
      failedRetry: number;
      failed: number;
      duration_ms: number;
    };
    expect(body.ok).toBe(true);
    expect(body.picked).toBe(5);
    expect(body.sent).toBe(3);
    expect(body.failedRetry).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.duration_ms).toBeTypeOf("number");
    expect(flushOutboxMock).toHaveBeenCalledOnce();
  });

  test("Bearer accepte la casse (proxies lowercase)", async () => {
    flushOutboxMock.mockResolvedValueOnce({
      picked: 0,
      sent: 0,
      failedRetry: 0,
      failed: 0,
    });
    const r = makeRequest("/api/cron/mail-outbox-flush", {
      method: "POST",
      headers: { authorization: "bearer test-cron-secret-mail" },
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
  });

  test("500 + ok=false si flushOutbox throw", async () => {
    flushOutboxMock.mockRejectedValueOnce(new Error("DB connection lost"));
    const r = makeRequest("/api/cron/mail-outbox-flush", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret-mail" },
    });
    const res = await POST(r);
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("processing_failed");
  });
});
