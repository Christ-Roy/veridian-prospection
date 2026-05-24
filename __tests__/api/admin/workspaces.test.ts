/**
 * Tests des routes /api/admin/workspaces (GET list, POST create).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspace: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
  invalidateAllUserContexts: vi.fn(),
}));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    workspace = prismaMock.workspace;
  }
  return { PrismaClient };
});

// seedDefaultPipelineStages : mock no-op (couvert ailleurs cf
// src/lib/outreach/pipeline-stages.test.ts).
vi.mock("@/lib/outreach/pipeline-stages", () => ({
  seedDefaultPipelineStages: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/workspaces/route";
import { makeRequest, makeUserContext, makeForbidden, readJson } from "../_helpers";

describe("/api/admin/workspaces", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await GET();
      expect(res.status).toBe(403);
    });

    test("returns empty list when no workspaces", async () => {
      requireAdminMock.mockResolvedValue({
        ctx: makeUserContext({ isAdmin: true, tenantId: "t-1" }),
      });
      prismaMock.workspace.findMany.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as unknown[];
      expect(body).toEqual([]);
    });
  });

  describe("POST", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await POST(
        makeRequest("/api/admin/workspaces", {
          method: "POST",
          body: { name: "New" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});

/**
 * Anti-régression seed pipeline stages (ticket pipeline-stages-customisables
 * 2026-05-23) — la route doit appeler `seedDefaultPipelineStages` après
 * un workspace.create() sinon le nouveau workspace nait sans colonnes
 * kanban (UX cassée premier login).
 *
 * Source-level pour ne pas avoir à mocker createMany — sabotage : retirer
 * l'appel ou l'import rend ce test rouge.
 */
describe("admin/workspaces — seed pipeline stages post-create", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/app/api/admin/workspaces/route.ts"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("importe seedDefaultPipelineStages depuis lib outreach", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*seedDefaultPipelineStages[^}]*\}\s*from\s*["']@\/lib\/outreach\/pipeline-stages["']/,
    );
  });

  test("appelle seedDefaultPipelineStages(prisma, workspace.id) après workspace.create", () => {
    expect(source).toMatch(/seedDefaultPipelineStages\(\s*prisma\s*,\s*workspace\.id\s*\)/);
  });
});
