/**
 * Tests route POST /api/cron/imap-sync.
 *
 * Sabotage-test : si on enlève la vérif Bearer, le test "401 sans header"
 * rougirait.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const runImapSyncMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mail/imap-sync", () => ({
  runImapSync: runImapSyncMock,
}));

import { POST } from "@/app/api/cron/imap-sync/route";
import { makeRequest, readJson } from "../_helpers";

describe("/api/cron/imap-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "supersecret";
  });

  test("503 si CRON_SECRET manquant", async () => {
    delete process.env.CRON_SECRET;
    const req = makeRequest("http://localhost/api/cron/imap-sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  test("401 sans header Authorization", async () => {
    const req = makeRequest("http://localhost/api/cron/imap-sync", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("401 avec mauvais Bearer", async () => {
    const req = makeRequest("http://localhost/api/cron/imap-sync", {
      method: "POST",
      headers: { authorization: "Bearer notmysecret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("200 avec Bearer valide + appelle runImapSync", async () => {
    runImapSyncMock.mockResolvedValue({
      totalTenants: 2,
      okTenants: 2,
      failedTenants: 0,
      totalInserted: 5,
      perTenant: [],
    });
    const req = makeRequest("http://localhost/api/cron/imap-sync", {
      method: "POST",
      headers: { authorization: "Bearer supersecret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.totalInserted).toBe(5);
    expect(runImapSyncMock).toHaveBeenCalledOnce();
  });

  test("tolère casse bearer (proxies lowercase)", async () => {
    runImapSyncMock.mockResolvedValue({
      totalTenants: 0,
      okTenants: 0,
      failedTenants: 0,
      totalInserted: 0,
      perTenant: [],
    });
    const req = makeRequest("http://localhost/api/cron/imap-sync", {
      method: "POST",
      headers: { authorization: "bearer supersecret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test("500 si runImapSync throw", async () => {
    runImapSyncMock.mockRejectedValue(new Error("boom"));
    const req = makeRequest("http://localhost/api/cron/imap-sync", {
      method: "POST",
      headers: { authorization: "Bearer supersecret" },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
