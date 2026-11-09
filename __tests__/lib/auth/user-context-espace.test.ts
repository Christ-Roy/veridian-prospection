/**
 * Espace demandé par le MCP (`tenant_id` signé par le Hub) : retenu seulement si l'utilisateur en est
 * propriétaire ou membre dans Prospection, sinon espace par défaut. Jamais d'élargissement de droits.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const { tenantFindFirst, tenantFindUnique, memberFindFirst, memberFindMany } = vi.hoisted(() => ({
  tenantFindFirst: vi.fn(),
  tenantFindUnique: vi.fn(),
  memberFindFirst: vi.fn(),
  memberFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findFirst: tenantFindFirst, findUnique: tenantFindUnique },
    workspaceMember: { findFirst: memberFindFirst, findMany: memberFindMany },
    workspace: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth-config", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { buildUserContext } from "@/lib/auth/user-context";

const T_PROPRE = "11111111-1111-4111-8111-111111111111";
const T_AUTRE = "22222222-2222-4222-8222-222222222222";
let n = 0;
const user = () => ({ id: `u-${++n}`, email: "a@b.fr" }); // ids uniques : le cache est par utilisateur

beforeEach(() => {
  vi.clearAllMocks();
  memberFindMany.mockResolvedValue([]);
});

describe("buildUserContext, espace demandé", () => {
  test("espace d'un autre : refusé, retour à l'espace par défaut de l'utilisateur", async () => {
    const u = user();
    tenantFindFirst.mockImplementation(async ({ where }: { where: { id?: string; userId?: string } }) =>
      where.id === T_AUTRE ? { id: T_AUTRE, userId: "quelqu-un-d-autre" } : where.userId === u.id ? { id: T_PROPRE, userId: u.id } : null,
    );
    memberFindFirst.mockResolvedValue(null); // pas membre de T_AUTRE
    const ctx = await buildUserContext(u, null, T_AUTRE);
    expect(ctx?.tenantId).toBe(T_PROPRE);
  });

  test("espace dont il est membre : retenu", async () => {
    const u = user();
    tenantFindFirst.mockImplementation(async ({ where }: { where: { id?: string; userId?: string } }) =>
      where.id === T_AUTRE ? { id: T_AUTRE, userId: "proprietaire" } : where.userId === u.id ? { id: T_PROPRE, userId: u.id } : null,
    );
    memberFindFirst.mockResolvedValue({ userId: "u-x" });
    const ctx = await buildUserContext(u, null, T_AUTRE);
    expect(ctx?.tenantId).toBe(T_AUTRE);
    expect(ctx?.isAdmin).toBe(false);
  });

  test("identifiant qui n'est pas un UUID : ignoré sans requête", async () => {
    const u = user();
    tenantFindFirst.mockResolvedValue({ id: T_PROPRE, userId: u.id });
    const ctx = await buildUserContext(u, null, "mon-espace");
    expect(ctx?.tenantId).toBe(T_PROPRE);
    expect(tenantFindFirst).toHaveBeenCalledTimes(1);
  });
});
