/**
 * GET /api/hub/users (CONTRAT-HUB §3.8) : HMAC obligatoire, sur `${ts}.`, comptes actifs.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-hub-secret";
});
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: mocks.findMany } } }));

import { GET } from "@/app/api/hub/users/route";
import { makeRequest, readJson } from "../../_helpers";

function signed(body = "") {
  const ts = Date.now();
  return {
    "x-veridian-timestamp": String(ts),
    "x-veridian-hub-signature": createHmac("sha256", "test-hub-secret")
      .update(`${ts}.${body}`)
      .digest("hex"),
  };
}

describe("GET /api/hub/users", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 sans signature, aucune lecture", async () => {
    const res = await GET(makeRequest("/api/hub/users", { method: "GET" }));
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  test("401 sur Bearer avec le bon secret", async () => {
    const res = await GET(
      makeRequest("/api/hub/users", {
        method: "GET",
        headers: { authorization: "Bearer test-hub-secret" },
      }),
    );
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  test("401 si la signature porte sur un autre corps", async () => {
    const res = await GET(
      makeRequest("/api/hub/users", { method: "GET", headers: signed("autre") }),
    );
    expect(res.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  test("200 : forme du contrat, comptes supprimés exclus, sans lien visibles", async () => {
    mocks.findMany.mockResolvedValue([
      { hubUserId: "h1", email: "a@b.fr", name: "A" },
      { hubUserId: null, email: "c@d.fr", name: null },
    ]);
    const res = await GET(makeRequest("/api/hub/users", { method: "GET", headers: signed() }));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({
      users: [
        { hub_user_id: "h1", email: "a@b.fr", name: "A" },
        { hub_user_id: null, email: "c@d.fr", name: null },
      ],
    });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(mocks.findMany.mock.calls[0][0].select).toEqual({
      hubUserId: true,
      email: true,
      name: true,
    });
  });
});
