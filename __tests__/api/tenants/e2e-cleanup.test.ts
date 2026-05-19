/**
 * Tests de la route POST /api/tenants/e2e-cleanup (Hub-callable, cron staging).
 *
 * Couvre :
 *  - 500 si TENANT_API_SECRET non configuré
 *  - 401 si signature HMAC invalide
 *  - 401 si timestamp hors fenêtre
 *  - 500 si Supabase admin non configuré
 *  - dryRun: liste les comptes à supprimer sans supprimer
 *  - delete: supprime les comptes e2e-<ts>@yopmail.com plus vieux que olderThanHours
 *  - PROTECTED: e2e-persistent@yopmail.com n'est jamais supprimé
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const SECRET = "test-secret-cleanup";

vi.hoisted(() => {
  process.env.TENANT_API_SECRET = "test-secret-cleanup";
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
});

const { adminListUsersMock, adminDeleteUserMock, fromDeleteMock, createClientMock } =
  vi.hoisted(() => {
    const deleteBuilder = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(() => ({
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onFulfilled),
      })),
    };
    const listUsersMock = vi.fn();
    const deleteUserMock = vi.fn();
    const sb = {
      from: vi.fn(() => deleteBuilder),
      auth: { admin: { listUsers: listUsersMock, deleteUser: deleteUserMock } },
    };
    return {
      adminListUsersMock: listUsersMock,
      adminDeleteUserMock: deleteUserMock,
      fromDeleteMock: deleteBuilder,
      createClientMock: vi.fn(() => sb),
    };
  });

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

vi.mock("@prisma/client", () => {
  class PrismaClient {
    workspaceMember = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  }
  return { PrismaClient };
});

import { POST } from "@/app/api/tenants/e2e-cleanup/route";
import { makeRequest, readJson } from "../_helpers";

function signed(payload: string, extras: { driftMs?: number; badSig?: boolean } = {}) {
  const ts = Date.now() + (extras.driftMs ?? 0);
  const sig = extras.badSig
    ? "00".repeat(32)
    : createHmac("sha256", SECRET).update(`${payload}:${ts}`).digest("hex");
  return { timestamp: ts, signature: sig };
}

/** Standard HMAC contrat §6.1 : signature `{ts}.{rawBody}` dans les headers. */
function standardHeaders(rawBody: string): Record<string, string> {
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${rawBody}`).digest("hex");
  return {
    "x-veridian-timestamp": String(ts),
    "x-veridian-hub-signature": sig,
  };
}

describe("POST /api/tenants/e2e-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fromDeleteMock.delete.mockReturnValue(fromDeleteMock);
    fromDeleteMock.eq.mockImplementation(() => ({
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    }));
  });

  test("returns 401 on invalid signature", async () => {
    const req = makeRequest("/api/tenants/e2e-cleanup", {
      method: "POST",
      body: signed("e2e-cleanup", { badSig: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });

  test("returns 401 on stale timestamp", async () => {
    const req = makeRequest("/api/tenants/e2e-cleanup", {
      method: "POST",
      body: signed("e2e-cleanup", { driftMs: -10 * 60 * 1000 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("dryRun returns count and sample without deleting", async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    adminListUsersMock.mockResolvedValueOnce({
      data: {
        users: [
          { id: "u-1", email: "e2e-1700000000000@yopmail.com", created_at: oldDate },
          { id: "u-2", email: "e2e-1700000000001@yopmail.com", created_at: oldDate },
          { id: "u-3", email: "real-user@example.com", created_at: oldDate }, // ignored
          { id: "u-4", email: "e2e-persistent@yopmail.com", created_at: oldDate }, // protected
        ],
      },
      error: null,
    });

    const req = makeRequest("/api/tenants/e2e-cleanup", {
      method: "POST",
      body: { ...signed("e2e-cleanup"), dryRun: true, olderThanHours: 24 },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      dryRun: boolean;
      wouldDelete: number;
      sample: string[];
    };
    expect(body.dryRun).toBe(true);
    expect(body.wouldDelete).toBe(2);
    expect(body.sample).toEqual(
      expect.arrayContaining([
        "e2e-1700000000000@yopmail.com",
        "e2e-1700000000001@yopmail.com",
      ]),
    );
    // Pas d'appel deleteUser en dryRun
    expect(adminDeleteUserMock).not.toHaveBeenCalled();
  });

  test("accepte standard HMAC {ts}.{body} (contrat §6.1) — dryRun", async () => {
    adminListUsersMock.mockResolvedValueOnce({
      data: { users: [] },
      error: null,
    });

    const bodyObj = { dryRun: true, olderThanHours: 24 };
    const raw = JSON.stringify(bodyObj);
    const req = makeRequest("/api/tenants/e2e-cleanup", {
      method: "POST",
      headers: standardHeaders(raw),
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { dryRun: boolean; wouldDelete: number };
    expect(body.dryRun).toBe(true);
    expect(body.wouldDelete).toBe(0);
  });

  test("delete: removes matching throwaway users only", async () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    adminListUsersMock.mockResolvedValueOnce({
      data: {
        users: [
          { id: "u-old-1", email: "e2e-1700000000000@yopmail.com", created_at: oldDate },
          { id: "u-old-2", email: "e2e-1700000000001@yopmail.com", created_at: oldDate },
          { id: "u-recent", email: "e2e-1700000000999@yopmail.com", created_at: recentDate }, // too young
          { id: "u-real", email: "real@example.com", created_at: oldDate }, // ignored
        ],
      },
      error: null,
    });
    adminDeleteUserMock.mockResolvedValue({ error: null });

    const req = makeRequest("/api/tenants/e2e-cleanup", {
      method: "POST",
      body: { ...signed("e2e-cleanup"), olderThanHours: 24 },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      scanned: number;
      deleted: number;
      errorCount: number;
    };
    expect(body.scanned).toBe(2);
    expect(body.deleted).toBe(2);
    expect(body.errorCount).toBe(0);
    expect(adminDeleteUserMock).toHaveBeenCalledTimes(2);
    expect(adminDeleteUserMock).toHaveBeenCalledWith("u-old-1");
    expect(adminDeleteUserMock).toHaveBeenCalledWith("u-old-2");
    // u-recent et u-real NE SONT JAMAIS supprimés
    expect(adminDeleteUserMock).not.toHaveBeenCalledWith("u-recent");
    expect(adminDeleteUserMock).not.toHaveBeenCalledWith("u-real");
  });
});
