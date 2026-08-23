import { NextResponse, type NextRequest } from "next/server";
import { buildX402SkillsIndex, getX402PublicBaseUrl } from "@/lib/x402/discovery";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = getX402PublicBaseUrl(request.url);
  if (!baseUrl) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(buildX402SkillsIndex(baseUrl), {
    headers: { "Cache-Control": "public, max-age=0" },
  });
}
