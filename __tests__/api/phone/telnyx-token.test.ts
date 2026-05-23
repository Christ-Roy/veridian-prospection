/**
 * Tests de POST /api/phone/telnyx-token (génère un JWT WebRTC).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.hoisted(() => {
  delete process.env.TELNYX_API_KEY;
  delete process.env.TELNYX_CREDENTIAL_ID;
});

const { requireAuthMock, getTenantIdMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));

import { POST } from "@/app/api/phone/telnyx-token/route";

describe("POST /api/phone/telnyx-token", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  test("returns 500 when Telnyx credentials not configured (env captured at module load)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
