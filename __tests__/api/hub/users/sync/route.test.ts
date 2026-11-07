/**
 * POST /api/hub/users/sync (CONTRAT-HUB §3.8) : HMAC obligatoire, résolution par
 * hub_user_id seul, seuls les champs présents s'appliquent, deleted coupe l'accès.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-hub-secret";
});
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  tokenDeleteMany: vi.fn(),
  invalidateActive: vi.fn(),
  invalidateContext: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, update: mocks.update },
    ssoLoginToken: { deleteMany: mocks.tokenDeleteMany },
  },
}));
vi.mock("@/lib/auth/active-user", () => ({ invalidateActiveUser: mocks.invalidateActive }));
vi.mock("@/lib/auth/user-context", () => ({ invalidateUserContext: mocks.invalidateContext }));

import { POST } from "@/app/api/hub/users/sync/route";
import { makeRequest, readJson } from "../../../_helpers";

const HUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function post(payload: unknown) {
  const raw = JSON.stringify(payload);
  const ts = Date.now();
  return POST(
    makeRequest("/api/hub/users/sync", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": createHmac("sha256", "test-hub-secret")
          .update(`${ts}.${raw}`)
          .digest("hex"),
        "content-type": "application/json",
      },
      body: raw,
    }),
  );
}

describe("POST /api/hub/users/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "local-1",
      email: "ancien@x.fr",
      name: "Ancien",
      deletedAt: null,
    });
    mocks.update.mockResolvedValue({});
    mocks.tokenDeleteMany.mockResolvedValue({ count: 0 });
  });

  test("401 sans signature, aucune écriture", async () => {
    const res = await POST(
      makeRequest("/api/hub/users/sync", {
        method: "POST",
        headers: { authorization: "Bearer test-hub-secret" },
        body: JSON.stringify({ hub_user_id: HUB, deleted: true }),
      }),
    );
    expect(res.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("le compte se résout par hub_user_id, jamais par email", async () => {
    await post({ hub_user_id: HUB, email: "cible@x.fr" });
    expect(mocks.findUnique.mock.calls[0][0].where).toEqual({ hubUserId: HUB });
  });

  test("404 user_not_in_app si hub_user_id inconnu, même si l'email existe", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await post({ hub_user_id: HUB, email: "existe@x.fr" });
    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ error: "user_not_in_app" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("hub_user_id non UUID : 404, aucune requête (pas de P2023)", async () => {
    const res = await post({ hub_user_id: "cmpf9zkaw0000xxxxxxxxxxxx", name: "X" });
    expect(res.status).toBe(404);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  test("seuls les champs présents s'appliquent, et sur le seul compte visé", async () => {
    const res = await post({ hub_user_id: HUB, name: "Nouveau" });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ updated: true });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0][0].where).toEqual({ id: "local-1" });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ name: "Nouveau" });
    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
  });

  test("name null efface le nom, email normalisé en minuscules", async () => {
    await post({ hub_user_id: HUB, name: null, email: " Cible@X.fr " });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ name: null, email: "cible@x.fr" });
  });

  test("deleted coupe l'accès : deletedAt posé, jetons retirés, caches invalidés", async () => {
    const res = await post({ hub_user_id: HUB, deleted: true });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ updated: true });
    expect(mocks.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
    expect(mocks.tokenDeleteMany).toHaveBeenCalledWith({ where: { userId: "local-1" } });
    expect(mocks.invalidateActive).toHaveBeenCalledWith("local-1");
    expect(mocks.invalidateContext).toHaveBeenCalledWith("local-1");
  });

  test("idempotent : mêmes valeurs ou corps vide, updated false, aucune écriture", async () => {
    const same = await post({ hub_user_id: HUB, name: "Ancien", email: "ANCIEN@x.fr" });
    expect(same.status).toBe(200);
    expect(await readJson(same)).toEqual({ updated: false });
    const vide = await post({ hub_user_id: HUB });
    expect(await readJson(vide)).toEqual({ updated: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("deleted rejoué sur un compte déjà supprimé : updated false", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "local-1",
      email: "ancien@x.fr",
      name: "Ancien",
      deletedAt: new Date(),
    });
    const res = await post({ hub_user_id: HUB, deleted: true });
    expect(await readJson(res)).toEqual({ updated: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("un changement d'email invalide le cache de session", async () => {
    await post({ hub_user_id: HUB, email: "neuf@x.fr" });
    expect(mocks.invalidateActive).toHaveBeenCalledWith("local-1");
  });

  test("409 email_conflict si l'adresse est portée par un autre compte", async () => {
    mocks.update.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const res = await post({ hub_user_id: HUB, email: "pris@x.fr" });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ error: "email_conflict" });
  });

  test.each([
    [{ name: "X" }],
    [{ hub_user_id: HUB, email: "pas-un-email" }],
    [{ hub_user_id: HUB, name: 42 }],
    [{ hub_user_id: HUB, deleted: "oui" }],
    [{ hub_user_id: HUB, name: "x".repeat(201) }],
  ])("400 invalid_payload : %j", async (payload) => {
    const res = await post(payload);
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
