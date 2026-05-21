/**
 * Tests src/lib/hub/tenant-lookup.ts — résolution UUID OU email.
 *
 * Cf todo/2026-05-21-tenant-id-accept-email-or-uuid.md (Option B Robert).
 *
 * Couvre :
 *  - UUID existant → tenant
 *  - UUID inexistant → null
 *  - Email owner existant → tenant via JOIN users
 *  - Email user qui n'a pas de tenant → null
 *  - Email inexistant → null
 *  - String ni UUID ni email valide → null (treated as email, no match)
 *  - Email + plusieurs tenants → premier par createdAt ASC (déterministe)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      findFirst: mocks.tenantFindFirst,
    },
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

describe("resolveTenantByIdOrEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  test("UUID existant → tenant via tenants.id lookup", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: VALID_UUID,
      userId: OTHER_UUID,
    });
    const r = await resolveTenantByIdOrEmail(VALID_UUID);
    expect(r).toEqual({ id: VALID_UUID, userId: OTHER_UUID });
    expect(mocks.tenantFindUnique).toHaveBeenCalledWith({
      where: { id: VALID_UUID },
      select: { id: true, userId: true },
    });
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  test("UUID inexistant → null", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    expect(await resolveTenantByIdOrEmail(VALID_UUID)).toBeNull();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  test("Email owner existant → tenant via JOIN users + tenants.userId", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: "user-1" });
    mocks.tenantFindFirst.mockResolvedValueOnce({
      id: VALID_UUID,
      userId: "user-1",
    });
    const r = await resolveTenantByIdOrEmail("owner@example.com");
    expect(r).toEqual({ id: VALID_UUID, userId: "user-1" });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { email: "owner@example.com" },
      select: { id: true },
    });
    expect(mocks.tenantFindFirst).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true },
    });
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("Email d'un user sans tenant → null", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: "user-1" });
    mocks.tenantFindFirst.mockResolvedValueOnce(null);
    expect(await resolveTenantByIdOrEmail("orphan@example.com")).toBeNull();
  });

  test("Email inexistant en DB → null (pas d'appel tenant)", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    expect(await resolveTenantByIdOrEmail("ghost@example.com")).toBeNull();
    expect(mocks.tenantFindFirst).not.toHaveBeenCalled();
  });

  test("String aléatoire (ni UUID ni email valide) → traitée comme email, no match", async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null);
    expect(await resolveTenantByIdOrEmail("not-a-uuid-or-email")).toBeNull();
    expect(mocks.userFindUnique).toHaveBeenCalled();
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("UUID majuscule accepté (case-insensitive)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: VALID_UUID.toUpperCase(),
      userId: "u-1",
    });
    const r = await resolveTenantByIdOrEmail(VALID_UUID.toUpperCase());
    expect(r).not.toBeNull();
    expect(mocks.tenantFindUnique).toHaveBeenCalledOnce();
  });
});
