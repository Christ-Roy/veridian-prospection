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
});
