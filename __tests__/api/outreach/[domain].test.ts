/**
 * Tests des routes /api/outreach/[domain] (PUT, PATCH).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  queriesMock,
  invalidateMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  queriesMock: { updateOutreach: vi.fn(), patchOutreach: vi.fn() },
  invalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/cache", () => ({ invalidate: invalidateMock }));

import { PUT, PATCH } from "@/app/api/outreach/[domain]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ domain: "123456789" }) };

describe("/api/outreach/[domain]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("PUT", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(
        makeRequest("/api/outreach/123456789", { method: "PUT", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });

    test("returns 200 + invalidates stats on success", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });

      const res = await PUT(
        makeRequest("/api/outreach/123456789", {
          method: "PUT",
          body: { status: "contacte", notes: "appel court" },
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(queriesMock.updateOutreach).toHaveBeenCalled();
      expect(invalidateMock).toHaveBeenCalledWith("stats");
    });
  });

  describe("PATCH", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PATCH(
        makeRequest("/api/outreach/123456789", { method: "PATCH", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("safe parsing (no 500 on malformed JSON)", () => {
    // Régression : avant 2026-05-21, request.json() throw → propagation 500.
    // Maintenant .catch(() => ({})) fallback objet vide + handler accepte les
    // valeurs nullish via ?? defaults.
    test("PUT ne crash pas sur JSON malformé (retourne 200 avec defaults)", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });

      const res = await PUT(
        makeRequest("/api/outreach/123456789", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: "{not valid json",
        }),
        params,
      );
      expect(res.status).toBe(200);
      // updateOutreach appelée avec les defaults nullish (status="a_contacter", etc.)
      expect(queriesMock.updateOutreach).toHaveBeenCalledWith(
        "123456789",
        expect.objectContaining({ status: "a_contacter", notes: "" }),
        "t-1",
        "ws-1",
        "u-1",
      );
    });

    test("PATCH ne crash pas sur JSON malformé (retourne 200 avec body vide)", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");

      const res = await PATCH(
        makeRequest("/api/outreach/123456789", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{broken",
        }),
        params,
      );
      expect(res.status).toBe(200);
      // patchOutreach reçoit l'objet vide (PATCH = update partiel, OK)
      expect(queriesMock.patchOutreach).toHaveBeenCalledWith(
        "123456789",
        {},
        "t-1",
        undefined,
        "u-1",
      );
    });
  });
});
