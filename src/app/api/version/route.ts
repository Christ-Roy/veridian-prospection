import { NextResponse } from "next/server";
import pkg from "../../../../package.json";

export async function GET() {
  return NextResponse.json({
    commit_sha: process.env.COMMIT_SHA ?? "unknown",
    version: pkg.version ?? "unknown",
    built_at: process.env.BUILT_AT ?? "unknown",
  });
}
