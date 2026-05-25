/**
 * Tests route /api/admin/mail-templates — GET + POST.
 *
 * Couvre :
 *  - Auth admin only (403 si non admin, 401 si non auth)
 *  - 429 si rate limited
 *  - GET retourne la liste customs du tenant
 *  - POST 400 si payload invalide (slug regex, label vide, etc.)
 *  - POST 201 sur create OK + logAudit "mail.template_created"
 *  - POST 409 sur slug conflict (TenantTemplateConflictError)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { TenantTemplateConflictError } from "@/lib/mail/tenant-templates";

const {
  requireAdminMock,
  isRateLimitedMock,
  listCustomTemplatesMock,
  createTenantTemplateMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  listCustomTemplatesMock: vi.fn(),
  createTenantTemplateMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/mail/tenant-templates", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mail/tenant-templates")>(
    "@/lib/mail/tenant-templates",
  );
  return {
    ...actual,
    listCustomTemplates: listCustomTemplatesMock,
    createTenantTemplate: createTenantTemplateMock,
  };
});
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { GET, POST } from "@/app/api/admin/mail-templates/route";
import { makeRequest, readJson } from "../_helpers";

const ADMIN_CTX = { ctx: { userId: "u-1", tenantId: "t-1", isAdmin: true } };

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimitedMock.mockReturnValue(false);
});

describe("GET /api/admin/mail-templates", () => {
  test("403 si non admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  test("200 + liste templates customs du tenant", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    listCustomTemplatesMock.mockResolvedValue([
      { id: "tpl-1", slug: "ma-relance", label: "Ma relance" },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { templates: Array<{ slug: string }> };
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].slug).toBe("ma-relance");
    expect(listCustomTemplatesMock).toHaveBeenCalledWith("t-1");
  });
});

describe("POST /api/admin/mail-templates", () => {
  const VALID_BODY = {
    slug: "ma-relance",
    label: "Ma relance",
    subject: "Hello {{ prospect.name }}",
    bodyText: "Body text",
    bodyHtml: "<p>Body html</p>",
  };

  test("403 si non admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(
      makeRequest("/api/admin/mail-templates", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(403);
    expect(createTenantTemplateMock).not.toHaveBeenCalled();
  });

  test("429 si rate limited", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("/api/admin/mail-templates", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(429);
  });

  test("400 si slug invalide (regex)", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    const res = await POST(
      makeRequest("/api/admin/mail-templates", {
        method: "POST",
        body: { ...VALID_BODY, slug: "MAJ_pas_OK" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 si label manquant", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    const res = await POST(
      makeRequest("/api/admin/mail-templates", {
        method: "POST",
        body: { ...VALID_BODY, label: "" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("201 + template créé + logAudit", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    createTenantTemplateMock.mockResolvedValue({
      id: "tpl-new",
      slug: "ma-relance",
      label: "Ma relance",
      subject: "S",
      bodyText: "T",
      bodyHtml: "<p>T</p>",
      variables: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const res = await POST(
      makeRequest("/api/admin/mail-templates", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(201);
    const body = (await readJson(res)) as { template: { id: string } };
    expect(body.template.id).toBe("tpl-new");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mail.template_created" }),
    );
  });

  test("409 si slug déjà utilisé (TenantTemplateConflictError)", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    createTenantTemplateMock.mockRejectedValue(
      new TenantTemplateConflictError("ma-relance"),
    );
    const res = await POST(
      makeRequest("/api/admin/mail-templates", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { slug: string };
    expect(body.slug).toBe("ma-relance");
  });
});
