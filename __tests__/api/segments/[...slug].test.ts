/**
 * Tests des routes /api/segments/[...slug] (GET, POST, DELETE).
 *
 * Pattern fort : assert sur le BODY RETOURNÉ pour chaque happy path
 * (shape exact), pas juste 401. Détecte les changements de mapping ou
 * de shape côté queries (bug invitations 2026-05-23).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  queriesMock,
  invalidateMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  queriesMock: {
    getSegmentLeads: vi.fn(),
    addToSegment: vi.fn(),
    removeFromSegment: vi.fn(),
  },
  invalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/cache", () => ({ invalidate: invalidateMock }));

import { GET, POST, DELETE } from "@/app/api/segments/[...slug]/route";
import { makeRequest, readJson } from "../_helpers";

const params = { params: Promise.resolve({ slug: ["a-corriger"] }) };

describe("/api/segments/[...slug]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(makeRequest("/api/segments/x"), params);
      expect(res.status).toBe(401);
    });

    test("retourne les leads du segment — shape complet préservé", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.getSegmentLeads.mockResolvedValue({
        data: [{ siren: "111111111", denomination: "ACME" }],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        claudeAnalyzed: 0,
      });

      const res = await GET(makeRequest("/api/segments/a-corriger"), params);
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({
        data: [{ siren: "111111111", denomination: "ACME" }],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        claudeAnalyzed: 0,
      });
      // Le slug est composé via params.slug.join("/") — passe le segmentId à la query.
      expect(queriesMock.getSegmentLeads).toHaveBeenCalledWith(
        "a-corriger",
        expect.any(Object),
        "t-1",
      );
    });

    test("retourne un body bien shaped même si la query crash (defensive)", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.getSegmentLeads.mockRejectedValue(new Error("prisma boom"));

      const res = await GET(makeRequest("/api/segments/oops"), params);
      // Defensive : 500 mais body JSON propre (anti-régression commit ee51a49).
      expect(res.status).toBe(500);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toMatchObject({
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 1,
        claudeAnalyzed: 0,
        error: "prisma boom",
      });
    });

    test("retourne shape par défaut quand la query renvoie null", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.getSegmentLeads.mockResolvedValue(null);

      const res = await GET(makeRequest("/api/segments/empty"), params);
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toMatchObject({
        data: [],
        total: 0,
        totalPages: 1,
        claudeAnalyzed: 0,
      });
    });
  });

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(
        makeRequest("/api/segments/x", { method: "POST", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });

    test("returns 400 quand aucun domain n'est fourni", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      const res = await POST(
        makeRequest("/api/segments/x", {
          method: "POST",
          body: { domains: [] },
        }),
        params,
      );
      expect(res.status).toBe(400);
      const body = (await readJson(res)) as { error: string };
      expect(body).toEqual({ error: "No domains provided" });
    });

    test("ajoute les domains au segment et retourne {ok, added, total}", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.addToSegment.mockResolvedValue(2);

      const res = await POST(
        makeRequest("/api/segments/a-corriger", {
          method: "POST",
          body: { domains: ["acme.fr", "beta.fr"] },
        }),
        params,
      );
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({ ok: true, added: 2, total: 2 });
      expect(queriesMock.addToSegment).toHaveBeenCalledWith(
        ["acme.fr", "beta.fr"],
        "a-corriger",
        "t-1",
      );
      expect(invalidateMock).toHaveBeenCalledWith("segment-counts");
    });
  });

  describe("DELETE", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await DELETE(
        makeRequest("/api/segments/x", { method: "DELETE" }),
        params,
      );
      expect(res.status).toBe(401);
    });

    test("returns 400 quand aucun domain n'est fourni", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      const res = await DELETE(
        makeRequest("/api/segments/x", {
          method: "DELETE",
          body: { domains: [] },
        }),
        params,
      );
      expect(res.status).toBe(400);
      const body = (await readJson(res)) as { error: string };
      expect(body).toEqual({ error: "No domains provided" });
    });

    test("retire les domains du segment et retourne {ok, removed}", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.removeFromSegment.mockResolvedValue(3);

      const res = await DELETE(
        makeRequest("/api/segments/a-corriger", {
          method: "DELETE",
          body: { domains: ["acme.fr", "beta.fr", "gamma.fr"] },
        }),
        params,
      );
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({ ok: true, removed: 3 });
      expect(queriesMock.removeFromSegment).toHaveBeenCalledWith(
        ["acme.fr", "beta.fr", "gamma.fr"],
        "a-corriger",
        "t-1",
      );
    });
  });
});
