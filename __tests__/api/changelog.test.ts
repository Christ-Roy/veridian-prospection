/**
 * Tests de la route GET /api/changelog.
 *
 * Couvre :
 *  - parsing du `git log` en commits structurés
 *  - fallback gracieux si git log échoue (commits: [])
 *  - cache header présent
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: execSyncMock,
}));

import { GET } from "@/app/api/changelog/route";
import { readJson } from "./_helpers";

describe("GET /api/changelog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns parsed commits with sha/subject/date/author", async () => {
    execSyncMock.mockReturnValue(
      "abc1234|fix: bug|2026-05-18 10:00:00 +0000|Robert Brunon\n" +
        "def5678|feat: feature|2026-05-17 12:30:00 +0000|Robert Brunon",
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");

    const body = (await readJson(res)) as { commits: Array<Record<string, string>> };
    expect(body.commits).toHaveLength(2);
    expect(body.commits[0]).toEqual({
      sha: "abc1234",
      subject: "fix: bug",
      date: "2026-05-18 10:00:00 +0000",
      author: "Robert Brunon",
    });
  });

  test("returns empty commits + error when git log throws", async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("git not found");
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as { commits: unknown[]; error?: string };
    expect(body.commits).toEqual([]);
    expect(body.error).toBe("git log not available");
  });
});
