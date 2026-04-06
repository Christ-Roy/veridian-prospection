import { NextRequest, NextResponse } from "next/server";
import { getClaudeActivities, addClaudeActivity } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter } = await getWorkspaceScope();
  const { domain } = await params;
  const activities = await getClaudeActivities(domain, tenantId, filter);
  return NextResponse.json(activities, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId } = await getWorkspaceScope();
  const { domain: siren } = await params;
  const body = await request.json();

  const { activity_type, title, content, metadata } = body;
  if (!activity_type || !content) {
    return NextResponse.json(
      { error: "activity_type and content are required" },
      { status: 400 }
    );
  }

  const validTypes = ["analysis", "recommendation", "email_draft", "note", "action"];
  if (!validTypes.includes(activity_type)) {
    return NextResponse.json(
      { error: `Invalid activity_type. Must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const activity = await addClaudeActivity({
    siren,
    activity_type,
    title,
    content,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
  }, tenantId, insertId, auth.user.id);

  return NextResponse.json(activity, { status: 201 });
}
