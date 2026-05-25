/**
 * Tests unitaires pour src/lib/queries/inbox.ts
 *
 * Couvre :
 *   - encodeCursor/decodeCursor (roundtrip, invalid input)
 *   - listInboxEmails — filtre tenantId, workspaceFilter, direction, status,
 *     pagination hasMore + nextCursor, enrichissement entrepriseName
 *   - attachInboxEmail — happy path, not_found, forbidden tenant, forbidden
 *     workspace, siren_not_found
 *
 * Run: npx vitest run src/lib/queries/inbox.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockLeadEmailFindMany, mockLeadEmailFindUnique, mockLeadEmailUpdate, mockEntrepriseFindMany, mockEntrepriseFindUnique } = vi.hoisted(() => ({
  mockLeadEmailFindMany: vi.fn(),
  mockLeadEmailFindUnique: vi.fn(),
  mockLeadEmailUpdate: vi.fn(),
  mockEntrepriseFindMany: vi.fn(),
  mockEntrepriseFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leadEmail: {
      findMany: mockLeadEmailFindMany,
      findUnique: mockLeadEmailFindUnique,
      update: mockLeadEmailUpdate,
    },
    entreprise: {
      findMany: mockEntrepriseFindMany,
      findUnique: mockEntrepriseFindUnique,
    },
  },
}));

import {
  encodeCursor,
  decodeCursor,
  listInboxEmails,
  attachInboxEmail,
} from "./inbox";

beforeEach(() => {
  mockLeadEmailFindMany.mockReset();
  mockLeadEmailFindUnique.mockReset();
  mockLeadEmailUpdate.mockReset();
  mockEntrepriseFindMany.mockReset();
  mockEntrepriseFindUnique.mockReset();
});

describe("cursor encode/decode", () => {
  it("roundtrip preserves timestamp + id", () => {
    const ts = new Date("2026-05-25T12:34:56.000Z");
    const id = "a1b2c3d4-0000-4000-8000-000000000001";
    const cursor = encodeCursor(ts, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.ts.toISOString()).toBe(ts.toISOString());
    expect(decoded?.id).toBe(id);
  });

  it("returns null on garbage input", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null on cursor missing id", () => {
    const partial = Buffer.from("2026-05-25T00:00:00.000Z", "utf8").toString(
      "base64url",
    );
    expect(decodeCursor(partial)).toBeNull();
  });
});

describe("listInboxEmails — RBAC + filters", () => {
  it("scopes by tenantId (always)", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "tenant-aaa",
      workspaceFilter: null,
    });
    const call = mockLeadEmailFindMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe("tenant-aaa");
  });

  it("applies workspaceFilter when caller is not admin (filter !== null)", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: ["ws-a", "ws-b"],
    });
    const call = mockLeadEmailFindMany.mock.calls[0][0];
    expect(call.where.workspaceId).toEqual({ in: ["ws-a", "ws-b"] });
  });

  it("does NOT apply workspaceFilter for admin (filter === null)", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
    });
    const call = mockLeadEmailFindMany.mock.calls[0][0];
    expect(call.where.workspaceId).toBeUndefined();
  });

  it("filter direction=in maps to incoming", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      direction: "in",
    });
    expect(mockLeadEmailFindMany.mock.calls[0][0].where.direction).toBe(
      "incoming",
    );
  });

  it("filter direction=out maps to outgoing", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      direction: "out",
    });
    expect(mockLeadEmailFindMany.mock.calls[0][0].where.direction).toBe(
      "outgoing",
    );
  });

  it("filter status=orphan adds siren=null", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      status: "orphan",
    });
    expect(mockLeadEmailFindMany.mock.calls[0][0].where.siren).toBeNull();
  });

  it("filter status=attached adds siren not null", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      status: "attached",
    });
    expect(mockLeadEmailFindMany.mock.calls[0][0].where.siren).toEqual({
      not: null,
    });
  });

  it("invalid direction string falls back to all", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      direction: "garbage" as unknown as "all",
    });
    expect(mockLeadEmailFindMany.mock.calls[0][0].where.direction).toBeUndefined();
  });

  it("returns hasMore=false when results < limit", async () => {
    mockLeadEmailFindMany.mockResolvedValue([
      mailRow({ id: "a", siren: null }),
    ]);
    mockEntrepriseFindMany.mockResolvedValue([]);
    const result = await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      limit: 50,
    });
    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(1);
  });

  it("returns nextCursor when results exceed limit", async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      mailRow({ id: `id-${i}`, siren: null }),
    );
    mockLeadEmailFindMany.mockResolvedValue(rows);
    mockEntrepriseFindMany.mockResolvedValue([]);
    const result = await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      limit: 3,
    });
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
  });

  it("enriches items with entrepriseName when siren present", async () => {
    mockLeadEmailFindMany.mockResolvedValue([
      mailRow({ id: "a", siren: "900000001" }),
      mailRow({ id: "b", siren: null }),
    ]);
    mockEntrepriseFindMany.mockResolvedValue([
      { siren: "900000001", denomination: "ACME SAS" },
    ]);
    const result = await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.items[0].entrepriseName).toBe("ACME SAS");
    expect(result.items[1].entrepriseName).toBeNull();
  });

  it("body preview comes from bodyText preferred, then bodyHtml stripped", async () => {
    mockLeadEmailFindMany.mockResolvedValue([
      mailRow({ id: "a", bodyText: "Hello world", bodyHtml: "<p>ignored</p>" }),
      mailRow({ id: "b", bodyText: null, bodyHtml: "<p>From html</p>" }),
      mailRow({ id: "c", bodyText: null, bodyHtml: null }),
    ]);
    mockEntrepriseFindMany.mockResolvedValue([]);
    const result = await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.items[0].bodyPreview).toBe("Hello world");
    expect(result.items[1].bodyPreview).toBe("From html");
    expect(result.items[2].bodyPreview).toBeNull();
  });

  it("cursor restricts results to OR clause on (sentAt, createdAt, id)", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    const ts = new Date("2026-05-25T10:00:00.000Z");
    const cursor = encodeCursor(ts, "abc-123");
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      cursor,
    });
    const call = mockLeadEmailFindMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(Array.isArray(call.where.OR)).toBe(true);
  });

  it("invalid cursor is ignored silently (no throw)", async () => {
    mockLeadEmailFindMany.mockResolvedValue([]);
    await listInboxEmails({
      tenantId: "t-1",
      workspaceFilter: null,
      cursor: "broken",
    });
    const call = mockLeadEmailFindMany.mock.calls[0][0];
    expect(call.where.OR).toBeUndefined();
  });
});

describe("attachInboxEmail — RBAC + idempotency", () => {
  it("attaches when same tenant + siren exists", async () => {
    mockLeadEmailFindUnique.mockResolvedValue({
      id: "lid",
      tenantId: "t-1",
      workspaceId: "ws-a",
      siren: null,
    });
    mockEntrepriseFindUnique.mockResolvedValue({ siren: "900000001" });
    mockLeadEmailUpdate.mockResolvedValue({ id: "lid" });

    const result = await attachInboxEmail({
      leadEmailId: "lid",
      siren: "900000001",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.previousSiren).toBeNull();
    expect(mockLeadEmailUpdate).toHaveBeenCalledTimes(1);
  });

  it("returns not_found when email doesn't exist", async () => {
    mockLeadEmailFindUnique.mockResolvedValue(null);
    const result = await attachInboxEmail({
      leadEmailId: "lid",
      siren: "900000001",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("returns forbidden when email belongs to another tenant", async () => {
    mockLeadEmailFindUnique.mockResolvedValue({
      id: "lid",
      tenantId: "t-OTHER",
      workspaceId: "ws-x",
      siren: null,
    });
    const result = await attachInboxEmail({
      leadEmailId: "lid",
      siren: "900000001",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
    expect(mockLeadEmailUpdate).not.toHaveBeenCalled();
  });

  it("returns forbidden when email is outside member workspaceFilter", async () => {
    mockLeadEmailFindUnique.mockResolvedValue({
      id: "lid",
      tenantId: "t-1",
      workspaceId: "ws-other",
      siren: null,
    });
    const result = await attachInboxEmail({
      leadEmailId: "lid",
      siren: "900000001",
      tenantId: "t-1",
      workspaceFilter: ["ws-a", "ws-b"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });

  it("returns siren_not_found when siren doesn't exist in entreprises", async () => {
    mockLeadEmailFindUnique.mockResolvedValue({
      id: "lid",
      tenantId: "t-1",
      workspaceId: "ws-a",
      siren: null,
    });
    mockEntrepriseFindUnique.mockResolvedValue(null);
    const result = await attachInboxEmail({
      leadEmailId: "lid",
      siren: "900000001",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("siren_not_found");
    expect(mockLeadEmailUpdate).not.toHaveBeenCalled();
  });

  it("re-attach (already attached) — last write wins", async () => {
    mockLeadEmailFindUnique.mockResolvedValue({
      id: "lid",
      tenantId: "t-1",
      workspaceId: "ws-a",
      siren: "900000099",
    });
    mockEntrepriseFindUnique.mockResolvedValue({ siren: "900000001" });
    mockLeadEmailUpdate.mockResolvedValue({ id: "lid" });

    const result = await attachInboxEmail({
      leadEmailId: "lid",
      siren: "900000001",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.previousSiren).toBe("900000099");
  });
});

function mailRow(over: Partial<{
  id: string;
  siren: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}>) {
  return {
    id: over.id ?? "id-x",
    direction: "outgoing",
    siren: over.siren === undefined ? null : over.siren,
    fromEmail: "from@example.com",
    fromName: null,
    toEmails: ["to@example.com"],
    subject: "Sujet",
    bodyText: over.bodyText === undefined ? "Body" : over.bodyText,
    bodyHtml: over.bodyHtml === undefined ? null : over.bodyHtml,
    sentAt: new Date("2026-05-20T10:00:00.000Z"),
    sentStatus: "sent",
    createdAt: new Date("2026-05-20T10:00:00.000Z"),
  };
}
