/**
 * Tests src/lib/auth/freeze.ts — CONTRAT-HUB v1.5 §5.21.
 *
 * Couvre :
 *  - retourne false si aucun workspace_member freezed
 *  - retourne true si au moins un workspace_member freezed
 *  - ignore les workspace_members soft-deleted
 *  - ignore les workspaces soft-deleted (via filtre relation)
 *  - filtre bien par tenantId (pas de cross-tenant leak)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  memberFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspaceMember: { findFirst: mocks.memberFindFirst },
  },
}));

import { isUserFrozen } from "@/lib/auth/freeze";

describe("isUserFrozen", () => {
  beforeEach(() => vi.clearAllMocks());

  test("false si aucun freeze trouvé", async () => {
    mocks.memberFindFirst.mockResolvedValueOnce(null);
    expect(await isUserFrozen("u-1", "t-1")).toBe(false);
    expect(mocks.memberFindFirst).toHaveBeenCalledOnce();
  });

  test("true si au moins un workspace_member freezed pour ce user/tenant", async () => {
    mocks.memberFindFirst.mockResolvedValueOnce({ workspaceId: "ws-1" });
    expect(await isUserFrozen("u-1", "t-1")).toBe(true);
  });

  test("query filtre par userId, deletedAt=null, frozenAt not null, tenant", async () => {
    mocks.memberFindFirst.mockResolvedValueOnce(null);
    await isUserFrozen("u-1", "t-1");
    const args = mocks.memberFindFirst.mock.calls[0][0];
    expect(args.where.userId).toBe("u-1");
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.frozenAt).toEqual({ not: null });
    expect(args.where.workspace).toEqual({ tenantId: "t-1", deletedAt: null });
  });
});
