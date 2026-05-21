/**
 * Tests de la route GET /api/version.
 *
 * Couvre :
 *  - 200 + shape (commit_sha/version/built_at)
 *  - commit_sha lit process.env.COMMIT_SHA injecté au build
 *  - fallback "unknown" si var absente
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";

import { GET } from "@/app/api/version/route";

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

describe("GET /api/version", () => {
  const originalSha = process.env.COMMIT_SHA;
  const originalBuiltAt = process.env.BUILT_AT;

  beforeEach(() => {
    delete process.env.COMMIT_SHA;
    delete process.env.BUILT_AT;
  });

  afterEach(() => {
    if (originalSha === undefined) delete process.env.COMMIT_SHA;
    else process.env.COMMIT_SHA = originalSha;
    if (originalBuiltAt === undefined) delete process.env.BUILT_AT;
    else process.env.BUILT_AT = originalBuiltAt;
  });

  test("returns 200 with expected shape", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      commit_sha: string;
      version: string;
      built_at: string;
    };
    expect(body).toHaveProperty("commit_sha");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("built_at");
  });

  test("commit_sha reflects COMMIT_SHA env var when set", async () => {
    process.env.COMMIT_SHA = "abc1234";
    const res = await GET();
    const body = (await readJson(res)) as { commit_sha: string };
    expect(body.commit_sha).toBe("abc1234");
  });

  test("commit_sha falls back to 'unknown' when COMMIT_SHA absent", async () => {
    const res = await GET();
    const body = (await readJson(res)) as { commit_sha: string };
    expect(body.commit_sha).toBe("unknown");
  });

  test("built_at reflects BUILT_AT env var when set", async () => {
    process.env.BUILT_AT = "2026-05-21T16:00:00Z";
    const res = await GET();
    const body = (await readJson(res)) as { built_at: string };
    expect(body.built_at).toBe("2026-05-21T16:00:00Z");
  });
});
