/**
 * /auth/session-ended : retire le cookie d'une session refusée, jamais d'une session valable.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth-config", () => ({ auth: mocks.auth }));

import { GET } from "@/app/auth/session-ended/route";
import { makeRequest } from "../../api/_helpers";

describe("GET /auth/session-ended", () => {
  beforeEach(() => vi.clearAllMocks());

  test("session refusée : cookie retiré, retour à la page demandée", async () => {
    mocks.auth.mockResolvedValue({ expires: "x" });
    const res = await GET(makeRequest("/auth/session-ended", { searchParams: { next: "/pipeline?a=1" } }));
    expect(res.headers.get("location")).toMatch(/\/pipeline\?a=1$/);
    const cookies = res.headers.getSetCookie();
    // Un navigateur ignore un Set-Cookie `__Secure-` sans l'attribut Secure : sans lui,
    // la session survit et la page revient en boucle.
    const secure = cookies.find((c) => c.startsWith("__Secure-authjs.session-token="));
    expect(secure).toMatch(/;\s*Secure/i);
    expect(secure).toMatch(/Max-Age=0/i);
    expect(secure).toMatch(/Path=\//i);
    expect(cookies.some((c) => c.startsWith("authjs.session-token="))).toBe(true);
  });

  test("session valable : aucun cookie touché", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u" } });
    const res = await GET(makeRequest("/auth/session-ended", { searchParams: { next: "/pipeline" } }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test.each(["https://evil.example/x", "//evil.example/x", "/login"])(
    "next refusé %s : accueil",
    async (next) => {
      mocks.auth.mockResolvedValue({ expires: "x" });
      const res = await GET(makeRequest("/auth/session-ended", { searchParams: { next } }));
      expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    },
  );
});
