/**
 * Tests route /api/admin/mail-templates/[templateId] — PUT + DELETE.
 *
 * Couvre :
 *  - 403 si non admin
 *  - 429 si rate limited (PUT)
 *  - 400 si payload invalide
 *  - 404 si template introuvable (PUT et DELETE)
 *  - PUT 200 + maj + logAudit "mail.template_updated"
 *  - DELETE 200 + soft-delete + logAudit "mail.template_deleted"
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAdminMock,
  isRateLimitedMock,
  updateTenantTemplateMock,
  softDeleteTenantTemplateMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  updateTenantTemplateMock: vi.fn(),
  softDeleteTenantTemplateMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/mail/tenant-templates", () => ({
  updateTenantTemplate: updateTenantTemplateMock,
  softDeleteTenantTemplate: softDeleteTenantTemplateMock,
}));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { PUT, DELETE } from "@/app/api/admin/mail-templates/[templateId]/route";
import { makeRequest, readJson } from "../../_helpers";

const ADMIN_CTX = { ctx: { userId: "u-1", tenantId: "t-1", isAdmin: true } };
const PARAMS = Promise.resolve({ templateId: "tpl-1" });

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimitedMock.mockReturnValue(false);
});

describe("PUT /api/admin/mail-templates/[templateId]", () => {
  test("403 si non admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await PUT(
      makeRequest("/api/admin/mail-templates/tpl-1", {
        method: "PUT",
        body: { label: "x" },
      }),
      { params: PARAMS },
    );
    expect(res.status).toBe(403);
  });

  test("429 si rate limited", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    isRateLimitedMock.mockReturnValue(true);
    const res = await PUT(
      makeRequest("/api/admin/mail-templates/tpl-1", {
        method: "PUT",
        body: { label: "x" },
      }),
      { params: PARAMS },
    );
    expect(res.status).toBe(429);
  });

  test("400 si slug invalide (regex)", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    const res = await PUT(
      makeRequest("/api/admin/mail-templates/tpl-1", {
        method: "PUT",
        body: { slug: "MAJ_NOT_OK" },
      }),
      { params: PARAMS },
    );
    expect(res.status).toBe(400);
  });

  test("404 si template introuvable", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    updateTenantTemplateMock.mockResolvedValue(null);
    const res = await PUT(
      makeRequest("/api/admin/mail-templates/tpl-1", {
        method: "PUT",
        body: { label: "x" },
      }),
      { params: PARAMS },
    );
    expect(res.status).toBe(404);
  });

  test("200 + maj + logAudit", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    updateTenantTemplateMock.mockResolvedValue({
      id: "tpl-1",
      slug: "ma-relance",
      label: "Updated label",
      subject: "S",
      bodyText: "T",
      bodyHtml: "<p>T</p>",
      variables: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
    const res = await PUT(
      makeRequest("/api/admin/mail-templates/tpl-1", {
        method: "PUT",
        body: { label: "Updated label" },
      }),
      { params: PARAMS },
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { template: { label: string } };
    expect(body.template.label).toBe("Updated label");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail.template_updated",
        metadata: expect.objectContaining({ fieldsUpdated: ["label"] }),
      }),
    );
  });
});

describe("DELETE /api/admin/mail-templates/[templateId]", () => {
  test("403 si non admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await DELETE(
      makeRequest("/api/admin/mail-templates/tpl-1", { method: "DELETE" }),
      { params: PARAMS },
    );
    expect(res.status).toBe(403);
  });

  test("404 si template introuvable", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    softDeleteTenantTemplateMock.mockResolvedValue(false);
    const res = await DELETE(
      makeRequest("/api/admin/mail-templates/tpl-1", { method: "DELETE" }),
      { params: PARAMS },
    );
    expect(res.status).toBe(404);
  });

  test("200 + soft-delete + logAudit", async () => {
    requireAdminMock.mockResolvedValue(ADMIN_CTX);
    softDeleteTenantTemplateMock.mockResolvedValue(true);
    const res = await DELETE(
      makeRequest("/api/admin/mail-templates/tpl-1", { method: "DELETE" }),
      { params: PARAMS },
    );
    expect(res.status).toBe(200);
    expect(softDeleteTenantTemplateMock).toHaveBeenCalledWith("t-1", "tpl-1");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mail.template_deleted" }),
    );
  });
});
