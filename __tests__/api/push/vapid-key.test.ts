/**
 * Tests de la route GET /api/push/vapid-key.
 *
 * Endpoint public : le browser a besoin de la clé VAPID avant le subscribe.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { getVapidPublicKeyMock } = vi.hoisted(() => ({
  getVapidPublicKeyMock: vi.fn(),
}));

vi.mock("@/lib/web-push", () => ({
  getVapidPublicKey: getVapidPublicKeyMock,
}));

import { GET } from "@/app/api/push/vapid-key/route";
import { readJson } from "../_helpers";

describe("GET /api/push/vapid-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns the VAPID public key in JSON", async () => {
    getVapidPublicKeyMock.mockReturnValue("BNxxxFakePublicVapidKey");

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as { publicKey: string };
    expect(body.publicKey).toBe("BNxxxFakePublicVapidKey");
  });
});
