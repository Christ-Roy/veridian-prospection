/**
 * Tests de GET /api/outreach-emails/[domain].
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, getOutreachEmailsMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getOutreachEmailsMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/queries", () => ({ getOutreachEmails: getOutreachEmailsMock }));

import { GET } from "@/app/api/outreach-emails/[domain]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ domain: "123456789" }) };

describe("GET /api/outreach-emails/[domain]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/outreach-emails/123456789"), params);
    expect(res.status).toBe(401);
  });

  test("returns emails for the SIREN scoped to tenant", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getOutreachEmailsMock.mockResolvedValue([]);
    const res = await GET(makeRequest("/api/outreach-emails/123456789"), params);
    expect(res.status).toBe(200);
    expect(getOutreachEmailsMock).toHaveBeenCalledWith("123456789", "t-1");
  });
});
