/**
 * Tests POST /api/cron/process-outbox.
 *
 * Couvre :
 *  - 503 si CRON_SECRET non configuré (config bug, pas un attaquant)
 *  - 401 sans Authorization
 *  - 401 si Bearer ne match pas
 *  - 200 + résultat processOutbox quand auth OK
 *  - 500 + ok=false si processOutbox throw
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { processOutboxMock } = vi.hoisted(() => ({
  processOutboxMock: vi.fn(),
}));

vi.mock("@/lib/hub-webhook/outbox", () => ({
  processOutbox: processOutboxMock,
}));

import { POST } from "@/app/api/cron/process-outbox/route";
import { makeRequest, readJson } from "../_helpers";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret-xyz";
});

describe("POST /api/cron/process-outbox", () => {
  test("503 si CRON_SECRET non configuré", async () => {
    delete process.env.CRON_SECRET;
    const r = makeRequest("/api/cron/process-outbox", { method: "POST" });
    const res = await POST(r);
    expect(res.status).toBe(503);
    expect(processOutboxMock).not.toHaveBeenCalled();
  });

  test("401 sans header Authorization", async () => {
    const r = makeRequest("/api/cron/process-outbox", { method: "POST" });
    const res = await POST(r);
    expect(res.status).toBe(401);
    expect(processOutboxMock).not.toHaveBeenCalled();
  });

  test("401 si Bearer ne match pas le secret", async () => {
    const r = makeRequest("/api/cron/process-outbox", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
    expect(processOutboxMock).not.toHaveBeenCalled();
  });

  test("401 si schéma autre que Bearer (Basic, etc.)", async () => {
    const r = makeRequest("/api/cron/process-outbox", {
      method: "POST",
      headers: { authorization: "Basic dGVzdC1jcm9uLXNlY3JldC14eXo=" },
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
  });

  test("200 + résultats processOutbox quand auth OK", async () => {
    processOutboxMock.mockResolvedValueOnce({
      picked: 3,
      sent: 2,
      failed: 1,
      dead: 0,
    });
    const r = makeRequest("/api/cron/process-outbox", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret-xyz" },
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      ok: boolean;
      picked: number;
      sent: number;
      failed: number;
      dead: number;
      duration_ms: number;
    };
    expect(body.ok).toBe(true);
    expect(body.picked).toBe(3);
    expect(body.sent).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.dead).toBe(0);
    expect(body.duration_ms).toBeTypeOf("number");
    expect(processOutboxMock).toHaveBeenCalledOnce();
  });

  test("Bearer accepte la casse (proxies lowercase)", async () => {
    processOutboxMock.mockResolvedValueOnce({
      picked: 0,
      sent: 0,
      failed: 0,
      dead: 0,
    });
    const r = makeRequest("/api/cron/process-outbox", {
      method: "POST",
      headers: { authorization: "bearer test-cron-secret-xyz" },
    });
    const res = await POST(r);
    expect(res.status).toBe(200);
  });

  test("500 + ok=false si processOutbox throw", async () => {
    processOutboxMock.mockRejectedValueOnce(new Error("DB connection lost"));
    const r = makeRequest("/api/cron/process-outbox", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret-xyz" },
    });
    const res = await POST(r);
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("processing_failed");
  });
});
