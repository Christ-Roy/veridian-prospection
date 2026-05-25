/**
 * Tests route /api/mail/sending-account — GET (state) + POST (toggle).
 *
 * Couvre :
 *  - 401 si non auth (member ou admin)
 *  - GET : retourne provider + email + connectedAt + isAdmin
 *  - GET : 404 si pas de workspace
 *  - POST : 403 si pas admin (toggle réservé admin)
 *  - POST : 400 si provider invalide
 *  - POST : set gmail-via-hub → gmail_connected_at = NOW
 *  - POST : set 'none' → gmail_connected_at = null
 *  - POST : audit log mail.provider.changed
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const {
  requireUserMock,
  requireAdminMock,
  prismaMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspace: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireUser: requireUserMock,
  requireAdmin: requireAdminMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { GET, POST } from "@/app/api/mail/sending-account/route";
import { makeRequest, readJson } from "../_helpers";

const CTX_MEMBER = {
  userId: "u-1",
  email: "user@v.site",
  tenantId: "t-1",
  tenantOwnerId: "u-1",
  workspaces: [{ id: "ws-1", name: "w", slug: "w", role: "member" as const, visibilityScope: "all" as const }],
  isAdmin: false,
  activeWorkspaceId: "ws-1",
};

const CTX_ADMIN = { ...CTX_MEMBER, isAdmin: true };

describe("GET /api/mail/sending-account", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 si non auth", async () => {
    requireUserMock.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("404 si pas de workspace", async () => {
    requireUserMock.mockResolvedValue({
      ctx: { ...CTX_MEMBER, workspaces: [], activeWorkspaceId: null },
    });
    const res = await GET();
    expect(res.status).toBe(404);
  });

  test("404 si workspace absent en DB", async () => {
    requireUserMock.mockResolvedValue({ ctx: CTX_MEMBER });
    prismaMock.workspace.findUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  test("200 retourne provider + email + connectedAt + quota + isAdmin", async () => {
    requireUserMock.mockResolvedValue({ ctx: CTX_ADMIN });
    prismaMock.workspace.findUnique.mockResolvedValue({
      mailProvider: "gmail-via-hub",
      gmailConnectedAt: new Date("2026-05-25T10:00:00Z"),
      gmailQuotaPerDay: 250,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      provider: string;
      email: string;
      gmailConnectedAt: string;
      gmailQuotaPerDay: number;
      isAdmin: boolean;
    };
    expect(body.provider).toBe("gmail-via-hub");
    expect(body.email).toBe(CTX_ADMIN.email);
    expect(body.gmailConnectedAt).toBe("2026-05-25T10:00:00.000Z");
    expect(body.gmailQuotaPerDay).toBe(250);
    expect(body.isAdmin).toBe(true);
  });

  test("200 même pour member non admin (lecture autorisée)", async () => {
    requireUserMock.mockResolvedValue({ ctx: CTX_MEMBER });
    prismaMock.workspace.findUnique.mockResolvedValue({
      mailProvider: "none",
      gmailConnectedAt: null,
      gmailQuotaPerDay: 250,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { isAdmin: boolean; provider: string };
    expect(body.isAdmin).toBe(false);
    expect(body.provider).toBe("none");
  });
});

describe("POST /api/mail/sending-account", () => {
  beforeEach(() => vi.clearAllMocks());

  test("403 si pas admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(
      makeRequest("/api/mail/sending-account", {
        method: "POST",
        body: { provider: "gmail-via-hub" },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("400 si provider invalide", async () => {
    requireAdminMock.mockResolvedValue({ ctx: CTX_ADMIN });
    const res = await POST(
      makeRequest("/api/mail/sending-account", {
        method: "POST",
        body: { provider: "invalid" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 si body vide", async () => {
    requireAdminMock.mockResolvedValue({ ctx: CTX_ADMIN });
    const res = await POST(
      makeRequest("/api/mail/sending-account", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(400);
  });

  test("404 si admin sans workspace actif", async () => {
    requireAdminMock.mockResolvedValue({
      ctx: { ...CTX_ADMIN, workspaces: [], activeWorkspaceId: null },
    });
    const res = await POST(
      makeRequest("/api/mail/sending-account", {
        method: "POST",
        body: { provider: "gmail-via-hub" },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("toggle 'gmail-via-hub' → set + connectedAt + audit log", async () => {
    requireAdminMock.mockResolvedValue({ ctx: CTX_ADMIN });
    const fakeNow = new Date("2026-05-25T12:00:00Z");
    prismaMock.workspace.update.mockResolvedValue({
      mailProvider: "gmail-via-hub",
      gmailConnectedAt: fakeNow,
    });

    const res = await POST(
      makeRequest("/api/mail/sending-account", {
        method: "POST",
        body: { provider: "gmail-via-hub" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      provider: string;
      gmailConnectedAt: string;
    };
    expect(body.provider).toBe("gmail-via-hub");
    expect(body.gmailConnectedAt).toBe(fakeNow.toISOString());

    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws-1" },
        data: expect.objectContaining({
          mailProvider: "gmail-via-hub",
          gmailConnectedAt: expect.any(Date),
        }),
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail.provider.changed",
        metadata: { provider: "gmail-via-hub" },
      }),
    );
  });

  test("toggle 'none' → unset + gmail_connected_at à null", async () => {
    requireAdminMock.mockResolvedValue({ ctx: CTX_ADMIN });
    prismaMock.workspace.update.mockResolvedValue({
      mailProvider: "none",
      gmailConnectedAt: null,
    });

    const res = await POST(
      makeRequest("/api/mail/sending-account", {
        method: "POST",
        body: { provider: "none" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      provider: string;
      gmailConnectedAt: string | null;
    };
    expect(body.provider).toBe("none");
    expect(body.gmailConnectedAt).toBeNull();
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mailProvider: "none",
          gmailConnectedAt: null,
        }),
      }),
    );
  });
});
