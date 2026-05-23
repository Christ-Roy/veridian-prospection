/**
 * Tests de POST /api/invitations/[token]/accept (acceptation invitation publique).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { acceptInvitationMock, isRateLimitedMock } = vi.hoisted(() => ({
  acceptInvitationMock: vi.fn(),
  isRateLimitedMock: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/invitations", () => ({ acceptInvitation: acceptInvitationMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));

import { POST } from "@/app/api/invitations/[token]/accept/route";
import { makeRequest } from "../../_helpers";

const params = { params: Promise.resolve({ token: "tok-1" }) };

describe("POST /api/invitations/[token]/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  test("returns 429 when rate-limited", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("/api/invitations/tok-1/accept", {
        method: "POST",
        body: { password: "secret-password" },
      }),
      params,
    );
    expect(res.status).toBe(429);
  });

  test("returns 400 when password too short", async () => {
    const res = await POST(
      makeRequest("/api/invitations/tok-1/accept", {
        method: "POST",
        body: { password: "123" },
      }),
      params,
    );
    expect(res.status).toBe(400);
  });

  // Anti-régression migration Auth.js v5 (2026-05-23) :
  // la route doit retourner {userId, email, redirectTo} et SURTOUT PAS de
  // session Supabase. Le client ouvre la session via signIn("credentials")
  // côté React. Si quelqu'un re-introduit `session` ici, c'est qu'on est
  // reparti en arrière vers Supabase Auth.
  test("returns {userId, email, redirectTo} sans session Supabase (Auth.js v5)", async () => {
    acceptInvitationMock.mockResolvedValueOnce({
      userId: "user-uuid",
      email: "newbie@example.com",
      redirectTo: "/prospects",
    });
    const res = await POST(
      makeRequest("/api/invitations/tok-1/accept", {
        method: "POST",
        body: { password: "validpass12345", fullName: "New Bie" },
      }),
      params,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      userId: "user-uuid",
      email: "newbie@example.com",
      redirectTo: "/prospects",
    });
    expect(body).not.toHaveProperty("session");
    expect(acceptInvitationMock).toHaveBeenCalledWith({
      token: "tok-1",
      password: "validpass12345",
      fullName: "New Bie",
    });
  });

  test("returns 404 quand l'invitation est expirée/inconnue", async () => {
    acceptInvitationMock.mockRejectedValueOnce(
      new Error("invitation invalid or expired"),
    );
    const res = await POST(
      makeRequest("/api/invitations/expired-tok/accept", {
        method: "POST",
        body: { password: "validpass12345" },
      }),
      { params: Promise.resolve({ token: "expired-tok" }) },
    );
    expect(res.status).toBe(404);
  });
});
