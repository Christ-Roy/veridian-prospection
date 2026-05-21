import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      create: mockCreate,
    },
  },
}));

import { resolveOrCreateUserFromHub } from "@/lib/hub/identity";

const HUB_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_HUB_ID = "22222222-2222-2222-2222-222222222222";
const LOCAL_ID = "99999999-9999-9999-9999-999999999999";
const EMAIL = "alice@example.com";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockCreate.mockReset();
});

describe("resolveOrCreateUserFromHub", () => {
  it("renvoie l'user matché par hub_user_id sans toucher la DB", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: LOCAL_ID });

    const result = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(result).toEqual({
      id: LOCAL_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { hubUserId: HUB_ID },
      select: { id: true },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rétrocompat legacy : matche par users.id == hubUserId et backfille hub_user_id", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // by hubUserId
      .mockResolvedValueOnce({ id: HUB_ID, hubUserId: null }); // by id
    mockUpdate.mockResolvedValueOnce({});

    const result = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(result.id).toBe(HUB_ID);
    expect(result.createdByHub).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: HUB_ID },
      data: { hubUserId: HUB_ID },
    });
  });

  it("match par email avec hub_user_id NULL → backfill", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // by hubUserId
      .mockResolvedValueOnce(null) // by id (legacy)
      .mockResolvedValueOnce({ id: LOCAL_ID, hubUserId: null }); // by email
    mockUpdate.mockResolvedValueOnce({});

    const result = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(result).toEqual({
      id: LOCAL_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: LOCAL_ID },
      data: { hubUserId: HUB_ID },
    });
  });

  it("match par email avec hub_user_id différent → conflit, ne touche pas la DB", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: LOCAL_ID, hubUserId: OTHER_HUB_ID });

    const result = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(result).toEqual({
      id: LOCAL_ID,
      createdByHub: false,
      hubUserIdConflict: true,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("aucun match → création avec hub_user_id (rétrocompat: users.id = hubUserId)", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: HUB_ID });

    const result = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(result).toEqual({
      id: HUB_ID,
      createdByHub: true,
      hubUserIdConflict: false,
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        id: HUB_ID,
        email: EMAIL,
        hubUserId: HUB_ID,
        supabaseUserId: HUB_ID,
      },
      select: { id: true },
    });
  });

  it("idempotent : 2 appels successifs (post-création) renvoient le même id", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null) // call 1, by hubUserId
      .mockResolvedValueOnce(null) // call 1, by id
      .mockResolvedValueOnce(null) // call 1, by email
      .mockResolvedValueOnce({ id: HUB_ID }); // call 2, by hubUserId hit
    mockCreate.mockResolvedValueOnce({ id: HUB_ID });

    const first = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });
    const second = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(first.id).toBe(second.id);
    expect(first.createdByHub).toBe(true);
    expect(second.createdByHub).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("ne backfille pas si le user matché par legacy id a déjà hub_user_id == hubUserId", async () => {
    mockFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: HUB_ID, hubUserId: HUB_ID });

    const result = await resolveOrCreateUserFromHub({
      hubUserId: HUB_ID,
      email: EMAIL,
    });

    expect(result.id).toBe(HUB_ID);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
