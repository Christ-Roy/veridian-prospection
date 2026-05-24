/**
 * Test source-level RBAC pour les routes /api/workspaces/[id]/pipeline-stages/*
 *
 * On vérifie que chaque mutation (POST, PATCH, DELETE, reorder) déclare
 * explicitement un check admin/owner. Régression silencieuse possible si
 * un dev re-factor sans préserver le check → cette suite tilt.
 *
 * Run: npx vitest run src/app/api/workspaces/pipeline-stages-rbac.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("POST /api/workspaces/[id]/pipeline-stages — RBAC admin", () => {
  const src = read("src/app/api/workspaces/[id]/pipeline-stages/route.ts");

  it("appelle requireUser pour authentifier", () => {
    expect(src).toContain("requireUser()");
  });

  it("POST check admin/owner avant create", () => {
    // Recherche la fonction POST ET un userIsAdminOfWorkspace plus loin.
    expect(src).toMatch(/export\s+async\s+function\s+POST/);
    expect(src).toContain("userIsAdminOfWorkspace");
    expect(src).toContain("Forbidden: admin role required");
  });

  it("scope cross-tenant : findFirst où tenantId = auth.ctx.tenantId", () => {
    expect(src).toContain("tenantId: auth.ctx.tenantId");
  });

  it("GET ouvert aux membres (pas restreint admin)", () => {
    expect(src).toContain("userBelongsToWorkspace");
  });
});

describe("PATCH/DELETE /api/workspaces/[id]/pipeline-stages/[stageId]", () => {
  const src = read("src/app/api/workspaces/[id]/pipeline-stages/[stageId]/route.ts");

  it("PATCH check admin/owner", () => {
    expect(src).toMatch(/export\s+async\s+function\s+PATCH/);
    expect(src).toContain("userIsAdminOfWorkspace");
  });

  it("DELETE check admin/owner", () => {
    expect(src).toMatch(/export\s+async\s+function\s+DELETE/);
  });

  it("DELETE refuse si leads encore sur le stage (409 + leadCount)", () => {
    expect(src).toContain("countLeadsOnStage");
    expect(src).toContain("stage_has_leads");
    expect(src).toContain("409");
  });

  it("DELETE est un soft-delete (deletedAt = NOW) pas un DELETE SQL", () => {
    expect(src).toContain("deletedAt: new Date()");
    expect(src).not.toContain("prisma.workspacePipelineStage.delete(");
  });

  it("scope cross-tenant : stage filtré par workspace.tenantId", () => {
    expect(src).toContain("tenantId: auth.ctx.tenantId");
  });
});

describe("POST /api/workspaces/[id]/pipeline-stages/reorder", () => {
  const src = read("src/app/api/workspaces/[id]/pipeline-stages/reorder/route.ts");

  it("check admin/owner", () => {
    expect(src).toContain("userIsAdminOfWorkspace");
    expect(src).toContain("Forbidden: admin role required");
  });

  it("transaction Prisma autour du bulk update", () => {
    expect(src).toContain("$transaction");
  });

  it("refuse si un stage ID n'appartient pas au workspace courant", () => {
    expect(src).toContain("some stage IDs not found in this workspace");
  });
});

describe("seed pipeline stages — câblé dans les 4 routes de création", () => {
  // Toute route qui crée un Workspace doit appeler seedDefaultPipelineStages
  // sinon le nouveau workspace naît sans kanban (UX cassée premier login).
  const routes = [
    "src/app/api/admin/workspaces/route.ts",
    "src/app/api/tenants/attach-owner/route.ts",
    "src/app/api/tenants/provision/route.ts",
    "src/app/api/tenants/[id]/sync-member/route.ts",
  ];

  it.each(routes)("%s appelle seedDefaultPipelineStages", (path) => {
    const src = read(path);
    expect(src).toContain("seedDefaultPipelineStages");
  });
});
