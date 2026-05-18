/**
 * Tests de POST /api/outreach/test-send (envoi email de test).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, execSyncMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  execSyncMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("child_process", () => ({ execSync: execSyncMock }));

import { POST } from "@/app/api/outreach/test-send/route";
import { makeRequest } from "../_helpers";

describe("POST /api/outreach/test-send", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/outreach/test-send", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });
});
