/**
 * Une session JWT ne survit pas à la suppression du compte, et suit l'email du Hub.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst: mocks.findFirst } } }));

import { applyActiveUser, getActiveUser, invalidateActiveUser } from "./active-user";

const session = () => ({ user: { id: "", email: "jeton@x.fr", name: "Jeton" as string | null } });

describe("applyActiveUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateActiveUser("u1");
  });

  test("compte supprimé : la session perd son user, donc requireAuth répond 401", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const s = await applyActiveUser(session(), "u1");
    expect(s.user).toBeUndefined();
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "u1", deletedAt: null });
  });

  test("compte actif : l'email et le nom viennent de la base, pas du jeton", async () => {
    mocks.findFirst.mockResolvedValue({ email: "base@x.fr", name: "Base" });
    const s = await applyActiveUser(session(), "u1");
    expect(s.user).toEqual({ id: "u1", email: "base@x.fr", name: "Base" });
  });

  test("base injoignable : on laisse passer sans inventer d'email", async () => {
    mocks.findFirst.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await applyActiveUser(session(), "u1");
    expect(s.user).toEqual({ id: "u1", email: "jeton@x.fr", name: "Jeton" });
    warn.mockRestore();
  });

  test("revoke : session ouverte avant la coupure refusée, après acceptée", async () => {
    const cut = new Date(2_000_000);
    mocks.findFirst.mockResolvedValue({ email: "a@x.fr", name: null, sessionsValidAfter: cut });
    expect((await applyActiveUser(session(), "u1", 1_999_999)).user).toBeUndefined();
    expect((await applyActiveUser(session(), "u1", 2_000_001)).user?.email).toBe("a@x.fr");
  });

  test("revoke : un jeton sans authAt est antérieur, donc coupé", async () => {
    mocks.findFirst.mockResolvedValue({ email: "a@x.fr", name: null, sessionsValidAfter: new Date(1) });
    expect((await applyActiveUser(session(), "u1")).user).toBeUndefined();
  });

  test("sans coupure : un jeton sans authAt reste valable", async () => {
    mocks.findFirst.mockResolvedValue({ email: "a@x.fr", name: null, sessionsValidAfter: null });
    expect((await applyActiveUser(session(), "u1")).user?.email).toBe("a@x.fr");
  });

  test("cache : 1 lecture, et l'invalidation force la relecture", async () => {
    mocks.findFirst.mockResolvedValue({ email: "a@x.fr", name: null });
    await getActiveUser("u1");
    await getActiveUser("u1");
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    invalidateActiveUser("u1");
    mocks.findFirst.mockResolvedValue(null);
    expect(await getActiveUser("u1")).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
  });
});
