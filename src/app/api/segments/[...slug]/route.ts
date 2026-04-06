import { NextRequest, NextResponse } from "next/server";
import { getSegmentLeads, addToSegment, removeFromSegment } from "@/lib/queries";
import { invalidate } from "@/lib/cache";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

function slugToId(slug: string[]): string {
  return slug.join("/");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { slug } = await params;
  const segmentId = slugToId(slug);
  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(10, parseInt(sp.get("pageSize") ?? "50")));
  const sort = sp.get("sort") ?? undefined;
  const sortDir = sp.get("sortDir") === "asc" ? "asc" as const : "desc" as const;
  const seen = sp.get("seen") as "seen" | "unseen" | null;
  const claude = sp.get("claude") as "analyzed" | "not_analyzed" | null;
  const honeypot = sp.get("honeypot") as "safe" | "suspect" | null;
  const appele = sp.get("appele") as "appele" | "non_appele" | null;

  try {
    const result = await getSegmentLeads(
      segmentId,
      {
        page,
        pageSize,
        sort,
        sortDir,
        seen: seen ?? undefined,
        claude: claude ?? undefined,
        honeypot: honeypot ?? undefined,
        appele: appele ?? undefined,
      },
      tenantId,
    );
    // Defensive: always return a well-shaped JSON body (never undefined)
    const safe = result ?? {
      data: [],
      total: 0,
      page,
      pageSize,
      totalPages: 1,
      claudeAnalyzed: 0,
    };
    return NextResponse.json(safe, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    // Post-SIREN refactor defensive: any Prisma crash must return a
    // structured JSON, never an empty body that crashes the client's
    // JSON.parse (cf. commit ee51a49 client-side guard).
    console.error(`[api/segments/${segmentId}] failed:`, e);
    return NextResponse.json(
      {
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 1,
        claudeAnalyzed: 0,
        error: e instanceof Error ? e.message : "Internal error",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { slug } = await params;
  const segmentId = slugToId(slug);
  const body = await request.json();
  const domains: string[] = body.domains ?? [];

  if (domains.length === 0) {
    return NextResponse.json({ error: "No domains provided" }, { status: 400 });
  }

  const added = await addToSegment(domains, segmentId, tenantId);
  invalidate("segment-counts");
  return NextResponse.json({ ok: true, added, total: domains.length });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { slug } = await params;
  const segmentId = slugToId(slug);
  const body = await request.json();
  const domains: string[] = body.domains ?? [];

  if (domains.length === 0) {
    return NextResponse.json({ error: "No domains provided" }, { status: 400 });
  }

  const removed = await removeFromSegment(domains, segmentId, tenantId);
  invalidate("segment-counts");
  return NextResponse.json({ ok: true, removed });
}
