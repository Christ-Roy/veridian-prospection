/**
 * Tests de la route GET /api/auth/token (legacy login token Supabase).
 *
 * Couvre :
 *  - 400 si paramètre `t` manquant
 *  - redirect vers /login?error=invalid_token si token introuvable
 *  - redirect vers /login?error=token_used si déjà consommé
 *  - redirect vers /login?error=token_expired si > 24h
 *  - redirect vers / (succès) + token marqué utilisé
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

// Les routes API capturent souvent des `process.env.X` au module-load (top-level).
// On set donc les env AVANT que la route ne soit importée, via vi.hoisted().
vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
});

// Builder pour la chaîne SELECT : select().eq().maybeSingle()
function selectChain(result: { data: unknown; error: unknown }) {
  const b = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return b;
}

// Builder pour la chaîne UPDATE : update().eq() (awaité direct)
function updateChain() {
  const b: {
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    then?: unknown;
  } = {
    update: vi.fn(),
    eq: vi.fn(),
  };
  b.update.mockImplementation(() => b);
  // .eq() doit être thenable parce que le code fait `await supabase.from().update().eq()`
  b.eq.mockImplementation(() => {
    return {
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    };
  });
  return b;
}

const { supabaseMock, createClientMock } = vi.hoisted(() => {
  const sb = {
    from: vi.fn(),
  };
  return {
    supabaseMock: sb,
    createClientMock: vi.fn(() => sb),
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import { GET } from "@/app/api/auth/token/route";
import { makeRequest, readJson } from "../_helpers";

describe("GET /api/auth/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 400 when ?t= is missing", async () => {
    const req = makeRequest("/api/auth/token");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Token required");
  });

  test("redirects to /login?error=invalid_token when token not found", async () => {
    supabaseMock.from.mockReturnValue(
      selectChain({ data: null, error: null }),
    );
    const req = makeRequest("/api/auth/token", {
      searchParams: { t: "missing-token" },
    });
    const res = await GET(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/login?error=invalid_token");
  });

  test("redirects to /login?error=token_used when already used", async () => {
    const sc = selectChain({
      data: {
        id: "t-1",
        prospection_login_token_created_at: new Date().toISOString(),
        prospection_login_token_used: true,
      },
      error: null,
    });
    supabaseMock.from.mockReturnValueOnce(sc);
    const req = makeRequest("/api/auth/token", { searchParams: { t: "used" } });
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("/login?error=token_used");
  });

  test("redirects to /login?error=token_expired when > 24h", async () => {
    const old = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    supabaseMock.from.mockReturnValueOnce(
      selectChain({
        data: {
          id: "t-1",
          prospection_login_token_created_at: old,
          prospection_login_token_used: false,
        },
        error: null,
      }),
    );

    const req = makeRequest("/api/auth/token", { searchParams: { t: "old" } });
    const res = await GET(req);
    expect(res.headers.get("location")).toContain("/login?error=token_expired");
  });

  test("redirects to root and marks token used on valid token", async () => {
    const selectMock = selectChain({
      data: {
        id: "t-1",
        prospection_login_token_created_at: new Date().toISOString(),
        prospection_login_token_used: false,
      },
      error: null,
    });
    const updateMock = updateChain();
    // Premier appel = SELECT, deuxième = UPDATE
    supabaseMock.from
      .mockReturnValueOnce(selectMock)
      .mockReturnValueOnce(updateMock);

    const req = makeRequest("/api/auth/token", { searchParams: { t: "good" } });
    const res = await GET(req);

    expect(res.headers.get("location")).toMatch(/\/$/);
    expect(updateMock.update).toHaveBeenCalledWith({
      prospection_login_token_used: true,
    });
  });
});
