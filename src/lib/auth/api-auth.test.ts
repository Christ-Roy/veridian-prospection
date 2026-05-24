/**
 * Tests unitaires pour src/lib/auth/api-auth.ts
 *
 * Wrapper trivial mais HOT PATH : utilisé par toutes les routes API qui
 * appellent `requireAuth()` au début. Contrat à protéger :
 *   - Session vide → 401 NextResponse JSON {error: "Unauthorized"}
 *   - Session sans email → 401 (jamais d'utilisateur "anonyme" passé en aval)
 *   - Session sans id → 401 (idem)
 *   - Session complète → {user: {id, email}} (NEVER plus que ces 2 champs)
 *
 * Si un de ces tests rougit, on a soit un fail-OPEN (auth contournable),
 * soit un leak d'infos session non-publiques vers les handlers en aval.
 *
 * Run: npx vitest run src/lib/auth/api-auth.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
}));

vi.mock("@/lib/auth-config", () => ({
  auth: mockAuth,
}));

import { requireAuth } from "./api-auth";

beforeEach(() => {
  mockAuth.mockReset();
});

describe("requireAuth — fail-closed (toute session incomplète = 401)", () => {
  it("retourne 401 quand auth() retourne null", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await requireAuth();

    expect("error" in result).toBe(true);
    if (result.error) {
      expect(result.error.status).toBe(401);
      const body = await result.error.json();
      expect(body).toEqual({ error: "Unauthorized" });
    }
  });

  it("retourne 401 quand auth() retourne undefined", async () => {
    mockAuth.mockResolvedValueOnce(undefined);

    const result = await requireAuth();

    expect("error" in result).toBe(true);
    if (result.error) {
      expect(result.error.status).toBe(401);
    }
  });

  it("retourne 401 quand session sans user", async () => {
    mockAuth.mockResolvedValueOnce({ expires: "2099-01-01" });

    const result = await requireAuth();

    expect("error" in result).toBe(true);
  });

  it("retourne 401 quand user sans id", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { email: "x@y.test" },
      expires: "2099-01-01",
    });

    const result = await requireAuth();

    expect("error" in result).toBe(true);
    if (result.error) {
      expect(result.error.status).toBe(401);
    }
  });

  it("retourne 401 quand user sans email", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "u-1" },
      expires: "2099-01-01",
    });

    const result = await requireAuth();

    expect("error" in result).toBe(true);
    if (result.error) {
      expect(result.error.status).toBe(401);
    }
  });

  it("retourne 401 quand id est string vide", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "", email: "x@y.test" },
      expires: "2099-01-01",
    });

    const result = await requireAuth();
    expect("error" in result).toBe(true);
  });
});

describe("requireAuth — happy path", () => {
  it("retourne {user: {id, email}} quand session complète", async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: "u-42", email: "alice@veridian.site", name: "Alice", image: "..." },
      expires: "2099-01-01",
    });

    const result = await requireAuth();

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.user).toEqual({
        id: "u-42",
        email: "alice@veridian.site",
      });
      // Contrat strict : ne PAS leak name/image/autres champs vers les handlers
      // qui n'en ont pas besoin.
      expect(Object.keys(result.user).sort()).toEqual(["email", "id"]);
    }
  });

  it("retourne le user appelant.appellement à chaque invocation (pas de cache module-level)", async () => {
    mockAuth
      .mockResolvedValueOnce({
        user: { id: "u-1", email: "a@v.site" },
        expires: "2099-01-01",
      })
      .mockResolvedValueOnce({
        user: { id: "u-2", email: "b@v.site" },
        expires: "2099-01-01",
      });

    const r1 = await requireAuth();
    const r2 = await requireAuth();

    if (!("error" in r1)) expect(r1.user.id).toBe("u-1");
    if (!("error" in r2)) expect(r2.user.id).toBe("u-2");
    expect(mockAuth).toHaveBeenCalledTimes(2);
  });

  it("ne leak pas les tokens session (accessToken, sessionToken, etc.) vers les handlers", async () => {
    // Auth.js peut enrichir la session avec des champs sensibles côté JWT
    // (provider, access_token, sub interne, ...). Le contrat requireAuth
    // n'expose QUE id + email — pas de fuite latérale vers les handlers.
    mockAuth.mockResolvedValueOnce({
      user: {
        id: "u-99",
        email: "leak-test@veridian.site",
        name: "Should Not Leak",
        accessToken: "secret-bearer-token",
        sessionToken: "secret-session-token",
        provider: "google",
      } as unknown as { id: string; email: string },
      expires: "2099-01-01",
    });

    const result = await requireAuth();

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.user).toEqual({ id: "u-99", email: "leak-test@veridian.site" });
      // Defense-in-depth : aucun champ "token-like" ne doit traverser le wrapper.
      const userAsRecord = result.user as Record<string, unknown>;
      expect(userAsRecord.accessToken).toBeUndefined();
      expect(userAsRecord.sessionToken).toBeUndefined();
      expect(userAsRecord.provider).toBeUndefined();
    }
  });
});
