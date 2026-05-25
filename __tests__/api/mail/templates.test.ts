/**
 * Tests route GET /api/mail/templates — liste publique customs + fallbacks.
 *
 * Couvre :
 *  - 401 si non auth
 *  - 404 si tenant introuvable
 *  - 200 + retourne le merge customs + fallbacks (résultat listTenantTemplates)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, listTenantTemplatesMock } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    getTenantIdMock: vi.fn(),
    listTenantTemplatesMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/mail/tenant-templates", () => ({
  listTenantTemplates: listTenantTemplatesMock,
}));

import { GET } from "@/app/api/mail/templates/route";
import { readJson } from "../_helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/mail/templates", () => {
  test("401 si non auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("404 si tenant introuvable", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  test("200 + merge customs (isCustom=true) + fallbacks (isCustom=false)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    listTenantTemplatesMock.mockResolvedValue([
      { slug: "ma-relance", label: "Ma relance", isCustom: true },
      { slug: "relance-commerciale-v1", label: "Relance commerciale", isCustom: false },
      { slug: "demo-prospection-v1", label: "Proposition de démo", isCustom: false },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      templates: Array<{ slug: string; label: string; isCustom: boolean }>;
    };
    expect(body.templates).toHaveLength(3);
    expect(body.templates[0].isCustom).toBe(true);
    expect(body.templates.find((t) => t.slug === "relance-commerciale-v1")?.isCustom).toBe(false);
    expect(listTenantTemplatesMock).toHaveBeenCalledWith("t-1");
  });
});
