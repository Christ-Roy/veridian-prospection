/**
 * Tests GET /api/users/by-email — endpoint Hub Discovery (cf
 * veridian-hub/todo/2026-05-20-hub-discovery-by-email-pattern.md).
 *
 * Couvre :
 *  - 401 sans HMAC ni Bearer legacy
 *  - 401 signature invalide / timestamp drift
 *  - 400 email manquant / mal formé
 *  - 200 found=false si user inconnu
 *  - 200 found=false si user existe mais 0 membership
 *  - 200 found=false si tenant soft-deleted (workspace masqué)
 *  - 200 found=true + workspaces[] correctement agrégé (plan, role, magic_link_capable)
 *  - Email normalisé en lowercase + trim avant lookup
 *  - HMAC standard signe "${ts}." (body vide pour GET)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-discovery-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  memberFindMany: vi.fn(),
  tenantFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst },
    workspaceMember: { findMany: mocks.memberFindMany },
    tenant: { findMany: mocks.tenantFindMany },
  },
}));

import { GET } from "@/app/api/users/by-email/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-discovery-secret";

function signedHeaders(ts = Date.now()) {
  // Pour GET le rawBody signé est la chaîne vide → signature de `${ts}.`
  const sig = createHmac("sha256", SECRET).update(`${ts}.`).digest("hex");
  return {
    "x-veridian-timestamp": String(ts),
    "x-veridian-hub-signature": sig,
  };
}

function req(searchParams: Record<string, string>, headers: Record<string, string> = {}) {
  return makeRequest("/api/users/by-email", {
    method: "GET",
    headers,
    searchParams,
  });
}

describe("GET /api/users/by-email — Hub Discovery", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── Auth ───────────────────────────────────────────────────────────────
  test("401 si aucun header HMAC ni Authorization", async () => {
    const res = await GET(req({ email: "x@y.com" }));
    expect(res.status).toBe(401);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  test("401 si signature invalide — pas de fuite DB", async () => {
    const ts = Date.now();
    const res = await GET(
      req(
        { email: "x@y.com" },
        {
          "x-veridian-timestamp": String(ts),
          "x-veridian-hub-signature": "deadbeef".repeat(8),
        },
      ),
    );
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("Invalid signature");
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  test("401 si timestamp drift > 5 min — anti-replay", async () => {
    const oldTs = Date.now() - 10 * 60 * 1000;
    const res = await GET(req({ email: "x@y.com" }, signedHeaders(oldTs)));
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  // ─── Validation ─────────────────────────────────────────────────────────
  test("400 si email manquant", async () => {
    const res = await GET(req({}, signedHeaders()));
    expect(res.status).toBe(400);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "missing_email",
    });
  });

  test("400 si email mal formé", async () => {
    const res = await GET(req({ email: "not-an-email" }, signedHeaders()));
    expect(res.status).toBe(400);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "invalid_email",
    });
  });

  test("400 si email > 254 caractères (RFC 5321)", async () => {
    const longEmail = "a".repeat(250) + "@x.fr";
    const res = await GET(req({ email: longEmail }, signedHeaders()));
    expect(res.status).toBe(400);
  });

  // ─── Lookup ─────────────────────────────────────────────────────────────
  test("200 found=false si user inconnu", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    const res = await GET(req({ email: "ghost@x.com" }, signedHeaders()));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ found: false });
    expect(mocks.userFindFirst).toHaveBeenCalledWith({
      where: { email: "ghost@x.com", deletedAt: null },
      select: { id: true, email: true },
    });
  });

  test("200 found=false si user existe mais 0 membership", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "u1", email: "x@y.com" });
    mocks.memberFindMany.mockResolvedValue([]);

    const res = await GET(req({ email: "x@y.com" }, signedHeaders()));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ found: false });
    // tenant.findMany NE DOIT PAS être appelé (early return)
    expect(mocks.tenantFindMany).not.toHaveBeenCalled();
  });

  test("200 found=false si tenant suspendu (Stripe past_due)", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "u1", email: "x@y.com" });
    mocks.memberFindMany.mockResolvedValue([
      {
        role: "owner",
        workspace: { id: "w1", name: "Acme", tenantId: "t1" },
      },
    ]);
    mocks.tenantFindMany.mockResolvedValue([
      { id: "t1", plan: "freemium", status: "suspended" },
    ]);

    const res = await GET(req({ email: "x@y.com" }, signedHeaders()));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ found: false });
  });

  test("200 found=false si tenant soft-deleted (absent du résultat tenant.findMany)", async () => {
    // La query côté route filtre `deletedAt: null` → le tenant n'apparaît
    // pas dans le résultat → on cache le workspace.
    mocks.userFindFirst.mockResolvedValue({ id: "u1", email: "x@y.com" });
    mocks.memberFindMany.mockResolvedValue([
      {
        role: "owner",
        workspace: { id: "w1", name: "Acme", tenantId: "t1" },
      },
    ]);
    mocks.tenantFindMany.mockResolvedValue([]); // tenant filtré par deletedAt

    const res = await GET(req({ email: "x@y.com" }, signedHeaders()));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ found: false });
  });

  test("200 found=true avec workspaces[] complets", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "u1", email: "user@acme.fr" });
    mocks.memberFindMany.mockResolvedValue([
      {
        role: "owner",
        workspace: { id: "w1", name: "Acme", tenantId: "t1" },
      },
      {
        role: "member",
        workspace: { id: "w2", name: "Acme Ventes", tenantId: "t1" },
      },
    ]);
    mocks.tenantFindMany.mockResolvedValue([
      { id: "t1", plan: "pro", status: "active" },
    ]);

    const res = await GET(req({ email: "user@acme.fr" }, signedHeaders()));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      found: boolean;
      user_email: string;
      workspaces: Array<Record<string, unknown>>;
    };
    expect(body.found).toBe(true);
    expect(body.user_email).toBe("user@acme.fr");
    expect(body.workspaces).toHaveLength(2);
    expect(body.workspaces[0]).toEqual({
      workspace_id: "w1",
      workspace_name: "Acme",
      role: "owner",
      plan: "pro",
      magic_link_capable: true,
      fallback_url: "https://prospection.app.veridian.site/login",
    });
    expect(body.workspaces[1].role).toBe("member");
  });

  test("plan fallback freemium si tenant.plan null", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "u1", email: "x@y.com" });
    mocks.memberFindMany.mockResolvedValue([
      { role: "owner", workspace: { id: "w1", name: "W", tenantId: "t1" } },
    ]);
    mocks.tenantFindMany.mockResolvedValue([
      { id: "t1", plan: null, status: "active" },
    ]);

    const res = await GET(req({ email: "x@y.com" }, signedHeaders()));
    const body = (await readJson(res)) as { workspaces: Array<{ plan: string }> };
    expect(body.workspaces[0].plan).toBe("freemium");
  });

  test("email normalisé en lowercase + trim avant lookup (anti-bypass cache Hub)", async () => {
    mocks.userFindFirst.mockResolvedValue(null);

    await GET(req({ email: "  USER@ACME.FR  " }, signedHeaders()));
    expect(mocks.userFindFirst).toHaveBeenCalledWith({
      where: { email: "user@acme.fr", deletedAt: null },
      select: { id: true, email: true },
    });
  });

  // ─── Sécurité supplémentaire ────────────────────────────────────────────
  test("ne expose pas le user_id Prosp au Hub (PII minimization)", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "u1-secret-uuid", email: "x@y.com" });
    mocks.memberFindMany.mockResolvedValue([
      { role: "owner", workspace: { id: "w1", name: "W", tenantId: "t1" } },
    ]);
    mocks.tenantFindMany.mockResolvedValue([
      { id: "t1", plan: "pro", status: "active" },
    ]);

    const res = await GET(req({ email: "x@y.com" }, signedHeaders()));
    const text = await res.text();
    expect(text).not.toContain("u1-secret-uuid");
    expect(text).not.toContain("tenantId");
    expect(text).not.toContain("t1"); // tenant_id non exposé
  });
});

// ─── Legacy Bearer observability (fenêtre 7j avant flip ACCEPT_LEGACY_BEARER=0) ──
describe("GET /api/users/by-email — legacy Bearer observability", () => {
  test("log warn explicite quand legacy Bearer accepté", async () => {
    // Le module lit ACCEPT_LEGACY_BEARER à l'import. On bascule l'env puis
    // on re-importe via resetModules.
    vi.resetModules();
    process.env.ACCEPT_LEGACY_BEARER = "1";

    // Re-mock prisma pour le module fraîchement importé
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        user: { findFirst: vi.fn().mockResolvedValue(null) },
        workspaceMember: { findMany: vi.fn() },
        tenant: { findMany: vi.fn() },
      },
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { GET: GETreloaded } = await import(
        "@/app/api/users/by-email/route"
      );
      const request = makeRequest("/api/users/by-email", {
        method: "GET",
        headers: { authorization: `Bearer ${SECRET}` },
        searchParams: { email: "x@y.com" },
      });
      const res = await GETreloaded(request);
      expect(res.status).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("legacy Bearer accepted"),
      );
    } finally {
      warnSpy.mockRestore();
      process.env.ACCEPT_LEGACY_BEARER = "0";
      vi.doUnmock("@/lib/prisma");
      vi.resetModules();
    }
  });
});
