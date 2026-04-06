import { NextResponse } from "next/server";
import { execSync } from "child_process";

/**
 * GET /api/changelog — last 30 commits from git log.
 * Useful for admin dashboard "what was deployed" view.
 * Cached 5 minutes.
 */
export async function GET() {
  try {
    const log = execSync(
      'git log --oneline --no-merges -30 --format="%h|%s|%ai|%an"',
      { encoding: "utf-8", timeout: 5000, cwd: process.cwd() }
    ).trim();

    const commits = log.split("\n").filter(Boolean).map(line => {
      const [sha, subject, date, author] = line.split("|");
      return { sha, subject, date, author };
    });

    return NextResponse.json({ commits }, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json({ commits: [], error: "git log not available" });
  }
}
