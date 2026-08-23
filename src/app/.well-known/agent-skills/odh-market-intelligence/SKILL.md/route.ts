import { NextResponse, type NextRequest } from "next/server";
import { buildX402SkillMarkdown, getX402PublicBaseUrl } from "@/lib/x402/discovery";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = getX402PublicBaseUrl(request.url);
  if (!baseUrl) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(buildX402SkillMarkdown(baseUrl), {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=0",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
