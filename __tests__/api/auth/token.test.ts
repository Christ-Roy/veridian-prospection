/**
 * Tests de GET /api/auth/token — autologin one-shot Hub → Prospection.
 *
 * Couvre (2026-05-20 — refactor Supabase → Prisma + Auth.js JWT) :
 *  - 400 si paramètre `t` manquant
 *  - redirect /login?error=invalid_token si token inconnu en DB
 *  - redirect /login?error=token_used si déjà consommé
 *  - redirect /login?error=token_expired si > 24h
 *  - redirect / + cookie session set + marquage `usedAt` sur token valide
 *  - redirect /login?error=server_error si AUTH_SECRET absent
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "test-secret-veridian-prosp-AAAAAAAAAAAAAAAAAAAA";
  process.env.NODE_ENV = "test";
});

const { tenantMock, userMock, encodeMock } = vi.hoisted(() => ({
  tenantMock: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  userMock: {
    findUnique: vi.fn(),
  },
  encodeMock: vi.fn().mockResolvedValue("fake.jwt.session"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: tenantMock,
    user: userMock,
  },
}));

vi.mock("next-auth/jwt", () => ({
  encode: encodeMock,
}));

import { GET } from "@/app/api/auth/token/route";
import { makeRequest, readJson } from "../_helpers";

describe("GET /api/auth/token — autologin Prisma + Auth.js JWT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encodeMock.mockResolvedValue("fake.jwt.session");
  });

  test("returns 400 when ?t= is missing", async () => {
    const res = await GET(makeRequest("/api/auth/token"));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Token required");
  });

  test("redirects to /login?error=invalid_token when token not in DB", async () => {
    tenantMock.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("/api/auth/token", { searchParams: { t: "missing" } }));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/login?error=invalid_token");
  });

  test("redirects to /login?error=token_used when already consumed", async () => {
    tenantMock.findFirst.mockResolvedValue({
      id: "t-1",
      userId: "u-1",
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: new Date(),
    });
    const res = await GET(makeRequest("/api/auth/token", { searchParams: { t: "used" } }));
    expect(res.headers.get("location")).toContain("/login?error=token_used");
  });

  test("redirects to /login?error=token_expired when > 24h", async () => {
    tenantMock.findFirst.mockResolvedValue({
      id: "t-1",
      userId: "u-1",
      prospectionLoginTokenCreatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
      prospectionLoginTokenUsedAt: null,
    });
    const res = await GET(makeRequest("/api/auth/token", { searchParams: { t: "old" } }));
    expect(res.headers.get("location")).toContain("/login?error=token_expired");
  });

  test("redirects to / + sets session cookie + marks token used on valid token", async () => {
    tenantMock.findFirst.mockResolvedValue({
      id: "t-1",
      userId: "u-1",
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    });
    tenantMock.updateMany.mockResolvedValue({ count: 1 });
    userMock.findUnique.mockResolvedValue({
      id: "u-1",
      email: "u@v.site",
      name: "User",
      image: null,
    });
    const res = await GET(makeRequest("/api/auth/token", { searchParams: { t: "good" } }));

    // Redirect vers /
    expect(res.headers.get("location")).toMatch(/\/$/);

    // Marquage atomique : updateMany avec filter prospectionLoginTokenUsedAt: null
    expect(tenantMock.updateMany).toHaveBeenCalledWith({
      where: { id: "t-1", prospectionLoginTokenUsedAt: null },
      data: { prospectionLoginTokenUsedAt: expect.any(Date) },
    });

    // JWT encoded via next-auth/jwt avec le bon payload
    expect(encodeMock).toHaveBeenCalledTimes(1);
    const encodeArg = encodeMock.mock.calls[0][0];
    expect(encodeArg.token).toEqual(expect.objectContaining({
      sub: "u-1",
      uid: "u-1",
      email: "u@v.site",
    }));

    // Cookie session set
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/authjs\.session-token=fake\.jwt\.session/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });

  test("race condition : si updateMany.count=0 → /login?error=token_used", async () => {
    tenantMock.findFirst.mockResolvedValue({
      id: "t-1",
      userId: "u-1",
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    });
    // Une autre tab a consommé entre le findFirst et l'updateMany
    tenantMock.updateMany.mockResolvedValue({ count: 0 });
    const res = await GET(makeRequest("/api/auth/token", { searchParams: { t: "race" } }));
    expect(res.headers.get("location")).toContain("/login?error=token_used");
  });

  test("redirect /login?error=server_error si AUTH_SECRET manquant", async () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    tenantMock.findFirst.mockResolvedValue({
      id: "t-1",
      userId: "u-1",
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    });
    tenantMock.updateMany.mockResolvedValue({ count: 1 });
    userMock.findUnique.mockResolvedValue({
      id: "u-1",
      email: "u@v.site",
      name: null,
      image: null,
    });

    const res = await GET(makeRequest("/api/auth/token", { searchParams: { t: "ok" } }));
    expect(res.headers.get("location")).toContain("/login?error=server_error");

    process.env.AUTH_SECRET = saved;
  });
});
