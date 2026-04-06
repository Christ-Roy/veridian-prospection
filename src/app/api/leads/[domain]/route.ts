import { NextRequest, NextResponse } from "next/server";
import { getLeadDetail, recordVisit } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";
import { isRateLimited } from "@/lib/rate-limit";

// Anti-scraping: max 30 lead detail views per minute per user
const LEADS_RATE_LIMIT = 30;
const LEADS_WINDOW_MS = 60_000;

// Sensitive fields to truncate for freemium users
const SENSITIVE_FIELDS = ["email", "dirigeant_email", "phone", "dirigeant", "qualite_dirigeant", "emails", "phones", "email_principal", "phone_principal"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const userId = auth.user.id;

  // Rate limiting: 30 fiches/min per user
  if (isRateLimited(`leads:${userId}`, LEADS_RATE_LIMIT, LEADS_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Trop de requetes. Reessayez dans quelques instants." },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }

  const tenantId = await getTenantId(userId);
  const { insertId: workspaceId } = await getWorkspaceScope();
  // URL param named `domain` for back-compat but now carries a SIREN (9 digits)
  const { domain: siren } = await params;
  const lead = await getLeadDetail(siren, tenantId);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  await recordVisit(siren, tenantId, workspaceId, userId);
  lead.last_visited = new Date().toISOString().replace("T", " ").split(".")[0];

  // Obfuscate sensitive fields only for expired freemium trials
  // Paid plans (pro, enterprise) never see obfuscated data
  const prospectLimit = await getTenantProspectLimit(userId);
  const isPaidPlan = prospectLimit > 300;
  if (!isPaidPlan) {
    // Import checkTrialExpired lazily to avoid circular deps
    const { checkTrialExpired } = await import("@/lib/trial");
    const isExpired = await checkTrialExpired(userId);
    if (isExpired) {
      const record = lead as unknown as Record<string, unknown>;
      for (const field of SENSITIVE_FIELDS) {
        const val = record[field];
        if (typeof val === "string" && val.length > 0) {
          // Don't break JSON arrays — replace with valid placeholder
          if (val.startsWith("[")) {
            record[field] = "[]";
          } else {
            const cutoff = Math.max(1, Math.floor(val.length * 0.33));
            record[field] = val.slice(0, cutoff) + "\u2022".repeat(val.length - cutoff);
          }
        }
      }
    }
  }

  return NextResponse.json(lead, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
