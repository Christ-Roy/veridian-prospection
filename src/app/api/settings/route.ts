import { NextRequest, NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

// GET /api/settings — read all settings from pipeline_config
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const settings = await getAllSettings(tenantId);
  return NextResponse.json(settings);
}

// POST /api/settings — write settings to pipeline_config
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);

  try {
    const body = await request.json();

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
    }

    // Each key-value pair is saved separately with "settings." prefix
    for (const [key, value] of Object.entries(body)) {
      const settingKey = key.startsWith("settings.") ? key : `settings.${key}`;
      await setSetting(settingKey, typeof value === "string" ? value : JSON.stringify(value), tenantId);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}
