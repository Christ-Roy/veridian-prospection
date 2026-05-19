import { describe, expect, test } from "vitest";
import {
  buildOutreachJoin,
  buildOutreachWhere,
  resolveVisibilityMode,
  type VisibilityScope,
} from "./visibility";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
const W1 = "00000000-0000-4000-8000-000000000010";
const W2 = "00000000-0000-4000-8000-000000000011";

const baseScope = (mode: VisibilityScope["mode"], extras: Partial<VisibilityScope> = {}): VisibilityScope => ({
  mode,
  tenantId: T,
  userId: U,
  workspaceIds: null,
  ...extras,
});

describe("buildOutreachJoin", () => {
  test("discovery mode filters by tenant only", () => {
    const sql = buildOutreachJoin(baseScope("discovery"));
    expect(sql).toBe(`AND o.tenant_id = '${T}'`);
  });

  test("mine mode filters by tenant only (workspace filter via WHERE)", () => {
    const sql = buildOutreachJoin(baseScope("mine"));
    expect(sql).toBe(`AND o.tenant_id = '${T}'`);
  });

  test("team mode adds workspace_id filter", () => {
    const sql = buildOutreachJoin(baseScope("team", { workspaceIds: [W1, W2] }));
    expect(sql).toContain(`o.tenant_id = '${T}'`);
    expect(sql).toContain(`o.workspace_id IN ('${W1}','${W2}')`);
    expect(sql).toContain("o.workspace_id IS NULL");
  });

  test("admin mode = tenant filter only (no workspace)", () => {
    const sql = buildOutreachJoin(baseScope("admin", { workspaceIds: [W1] }));
    expect(sql).toBe(`AND o.tenant_id = '${T}'`);
    expect(sql).not.toContain("workspace_id");
  });

  test("invalid tenantId throws (anti SQL injection)", () => {
    expect(() => buildOutreachJoin(baseScope("discovery", { tenantId: "not-a-uuid" })))
      .toThrow(/invalid uuid/);
    expect(() => buildOutreachJoin(baseScope("discovery", { tenantId: "'; DROP TABLE;--" })))
      .toThrow(/invalid uuid/);
  });
});

describe("buildOutreachWhere", () => {
  test("discovery: leads libres OR mes a_contacter", () => {
    const sql = buildOutreachWhere(baseScope("discovery"));
    expect(sql).toContain("o.siren IS NULL");
    expect(sql).toContain(`o.user_id = '${U}'`);
    expect(sql).toContain("COALESCE(o.status, 'a_contacter') = 'a_contacter'");
  });

  test("mine: filtre owner strict", () => {
    const sql = buildOutreachWhere(baseScope("mine"));
    expect(sql).toBe(`(o.user_id = '${U}')`);
  });

  test("team: pas de filtre user (déjà géré dans JOIN)", () => {
    const sql = buildOutreachWhere(baseScope("team", { workspaceIds: [W1] }));
    expect(sql).toBe("(TRUE)");
  });

  test("admin: pas de filtre user (full tenant access)", () => {
    const sql = buildOutreachWhere(baseScope("admin"));
    expect(sql).toBe("(TRUE)");
  });

  test("invalid userId throws", () => {
    expect(() => buildOutreachWhere(baseScope("mine", { userId: "abc" })))
      .toThrow(/invalid uuid/);
  });
});

describe("resolveVisibilityMode", () => {
  const ctxMember = {
    isAdmin: false,
    workspaces: [{ id: W1, visibilityScope: "own" as const }],
    activeWorkspaceId: W1,
  };
  const ctxTeamLead = {
    isAdmin: false,
    workspaces: [{ id: W1, visibilityScope: "all" as const }],
    activeWorkspaceId: W1,
  };
  const ctxAdmin = {
    isAdmin: true,
    workspaces: [{ id: W1, visibilityScope: "own" as const }],
    activeWorkspaceId: W1,
  };

  test("discovery is ALWAYS discovery for non-admin (anti double appel)", () => {
    expect(resolveVisibilityMode(ctxMember, "discovery")).toBe("discovery");
    expect(resolveVisibilityMode(ctxTeamLead, "discovery")).toBe("discovery");
    expect(resolveVisibilityMode(ctxAdmin, "discovery")).toBe("discovery");
  });

  test("discovery: admin avec override → admin (debug/audit)", () => {
    expect(resolveVisibilityMode(ctxAdmin, "discovery", true)).toBe("admin");
    // Non-admin ne peut pas override
    expect(resolveVisibilityMode(ctxMember, "discovery", true)).toBe("discovery");
  });

  test("history-pipeline: scope=own → mine", () => {
    expect(resolveVisibilityMode(ctxMember, "history-pipeline")).toBe("mine");
  });

  test("history-pipeline: scope=all → team", () => {
    expect(resolveVisibilityMode(ctxTeamLead, "history-pipeline")).toBe("team");
  });

  test("history-pipeline: admin override → admin", () => {
    expect(resolveVisibilityMode(ctxAdmin, "history-pipeline", true)).toBe("admin");
  });

  test("user sans workspace → mine (fallback safe)", () => {
    expect(
      resolveVisibilityMode(
        { isAdmin: false, workspaces: [], activeWorkspaceId: null },
        "history-pipeline",
      ),
    ).toBe("mine");
  });
});
