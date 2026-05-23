/**
 * Tests de la route POST /api/errors (client-side error reporting + persist DB).
 *
 * Contrat (ticket 2026-05-23-persist-client-errors-db.md) :
 *   - Persiste via prisma.clientError.upsert (dedupe par dedupeKey + heure)
 *   - 204 sur happy path (pas de body, pas de leak)
 *   - 400 si message manquant ou JSON malformé
 *   - 429 sur rate limit 10/min/IP
 *   - Best-effort : 204 même si DB down (jamais 5xx → évite loop ErrorBoundary)
 *   - Truncation PII : message 1000 / stack 2000 / userAgent 200
 *   - Dedupe key = sha1(message|filename|lineno).slice(0, 16)
 *   - occurredHour tronqué à HH:00:00.000 UTC
 *
 * Sabotage-test : altérer computeDedupeKey ou bucketToHour → tests rouges.
 *
 * Run: npx vitest run __tests__/api/errors.test.ts
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { makeRequest, readJson } from "./_helpers";

const { mockUpsert } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clientError: { upsert: mockUpsert },
  },
}));

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockUpsert.mockReset();
  mockUpsert.mockResolvedValue({});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function postReq(body: unknown, ip = `1.2.3.${Math.floor(Math.random() * 250)}`) {
  return makeRequest("/api/errors", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body,
  });
}

describe("POST /api/errors — happy path", () => {
  test("persiste un payload valide via upsert et renvoie 204", async () => {
    const { POST } = await import("@/app/api/errors/route");
    const res = await POST(
      postReq({
        message: "TypeError: foo",
        stack: "Error\n  at bar",
        url: "https://app/x",
        userAgent: "Mozilla/5.0",
        context: { filename: "/app/x.js", lineno: 42, source: "window.onerror" },
      }),
    );
    expect(res.status).toBe(204);
    expect(await readJson(res)).toBeNull();
    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0]![0]!;
    expect(call.where.dedupeKey_occurredHour.dedupeKey).toMatch(/^[a-f0-9]{16}$/);
    expect(call.create.message).toBe("TypeError: foo");
    expect(call.create.stack).toBe("Error\n  at bar");
    expect(call.create.url).toBe("https://app/x");
    expect(call.create.userAgent).toBe("Mozilla/5.0");
    expect(call.create.count).toBe(1);
    expect(call.update.count).toEqual({ increment: 1 });
  });

  test("dedupe key stable pour mêmes (message, filename, lineno)", async () => {
    const { POST } = await import("@/app/api/errors/route");
    await POST(postReq({ message: "boom", context: { filename: "a.js", lineno: 1 } }));
    await POST(postReq({ message: "boom", context: { filename: "a.js", lineno: 1 } }));
    const k1 = mockUpsert.mock.calls[0]![0]!.where.dedupeKey_occurredHour.dedupeKey;
    const k2 = mockUpsert.mock.calls[1]![0]!.where.dedupeKey_occurredHour.dedupeKey;
    expect(k1).toBe(k2);
  });

  test("dedupe key change si lineno change", async () => {
    const { POST } = await import("@/app/api/errors/route");
    await POST(postReq({ message: "boom", context: { filename: "a.js", lineno: 1 } }));
    await POST(postReq({ message: "boom", context: { filename: "a.js", lineno: 2 } }));
    const k1 = mockUpsert.mock.calls[0]![0]!.where.dedupeKey_occurredHour.dedupeKey;
    const k2 = mockUpsert.mock.calls[1]![0]!.where.dedupeKey_occurredHour.dedupeKey;
    expect(k1).not.toBe(k2);
  });

  test("occurredHour tronqué à HH:00:00.000 UTC", async () => {
    const { POST } = await import("@/app/api/errors/route");
    await POST(postReq({ message: "test bucket" }));
    const occurredHour: Date =
      mockUpsert.mock.calls[0]![0]!.where.dedupeKey_occurredHour.occurredHour;
    expect(occurredHour.getUTCMinutes()).toBe(0);
    expect(occurredHour.getUTCSeconds()).toBe(0);
    expect(occurredHour.getUTCMilliseconds()).toBe(0);
  });
});

describe("POST /api/errors — truncation PII", () => {
  test("tronque message > 1000 chars", async () => {
    const { POST } = await import("@/app/api/errors/route");
    await POST(postReq({ message: "x".repeat(1500) }));
    expect(mockUpsert.mock.calls[0]![0]!.create.message).toHaveLength(1000);
  });

  test("tronque stack > 2000 chars", async () => {
    const { POST } = await import("@/app/api/errors/route");
    await POST(postReq({ message: "ok", stack: "y".repeat(3000) }));
    expect(mockUpsert.mock.calls[0]![0]!.create.stack).toHaveLength(2000);
  });

  test("tronque userAgent > 200 chars", async () => {
    const { POST } = await import("@/app/api/errors/route");
    await POST(postReq({ message: "ok", userAgent: "z".repeat(500) }));
    expect(mockUpsert.mock.calls[0]![0]!.create.userAgent).toHaveLength(200);
  });
});

describe("POST /api/errors — error cases", () => {
  test("400 si message absent", async () => {
    const { POST } = await import("@/app/api/errors/route");
    const res = await POST(postReq({ stack: "no msg" }));
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("400 si JSON malformé", async () => {
    const { POST } = await import("@/app/api/errors/route");
    const req = makeRequest("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "2.3.4.5" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test("best-effort : 204 même si Prisma plante (DB down)", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("DB unreachable"));
    const { POST } = await import("@/app/api/errors/route");
    const res = await POST(postReq({ message: "boom" }));
    expect(res.status).toBe(204);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("rate-limit 10/min/IP (11ème = 429)", async () => {
    const { POST } = await import("@/app/api/errors/route");
    const ip = `9.9.9.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 10; i++) {
      const r = await POST(postReq({ message: `n${i}` }, ip));
      expect(r.status).toBe(204);
    }
    const blocked = await POST(postReq({ message: "over" }, ip));
    expect(blocked.status).toBe(429);
    const body = (await readJson(blocked)) as { reason?: string };
    expect(body?.reason).toBe("rate_limited");
  });
});

describe("helpers exportés (sabotage-test bait)", () => {
  test("computeDedupeKey retourne 16 chars hex stables + sensible aux 3 champs", async () => {
    const { computeDedupeKey } = await import("@/lib/errors/dedupe");
    const k = computeDedupeKey("hello", "x.js", 10);
    expect(k).toMatch(/^[a-f0-9]{16}$/);
    expect(computeDedupeKey("hello", "x.js", 10)).toBe(k);
    expect(computeDedupeKey("hello", "x.js", 11)).not.toBe(k);
    expect(computeDedupeKey("hello", "y.js", 10)).not.toBe(k);
    expect(computeDedupeKey("hellox", "x.js", 10)).not.toBe(k);
  });

  test("bucketToHour ramène à HH:00:00.000 UTC", async () => {
    const { bucketToHour } = await import("@/lib/errors/dedupe");
    const d = new Date("2026-05-23T14:37:42.123Z");
    expect(bucketToHour(d).toISOString()).toBe("2026-05-23T14:00:00.000Z");
  });
});
