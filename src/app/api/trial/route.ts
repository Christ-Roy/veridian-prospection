import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/api-auth";

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? "7", 10);

// GET /api/trial — returns trial state based on user creation date
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Internal mode (no Supabase) — always active trial
  if (auth.user.id === "internal") {
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "internal" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "unknown" });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(supabaseUrl, serviceKey);

    // Get user creation date
    const { data: userData } = await admin.auth.admin.getUserById(auth.user.id);
    const createdAt = userData?.user?.created_at;

    // Get tenant plan — try direct user_id first, then fall back to
    // workspace_members lookup (invited users don't own the tenant row)
    let tenant: { prospection_plan?: string; trial_ends_at?: string } | null = null;
    const { data: directTenant } = await admin
      .from("tenants")
      .select("prospection_plan, trial_ends_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    tenant = directTenant;

    if (!tenant) {
      // Invited member — resolve tenant via prospection workspace_members → workspaces.tenant_id → tenants
      const { prisma } = await import("@/lib/prisma");
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.user.id },
        include: { workspace: true },
      });
      if (membership?.workspace?.tenantId) {
        const { data: memberTenant } = await admin
          .from("tenants")
          .select("prospection_plan, trial_ends_at")
          .eq("id", membership.workspace.tenantId)
          .maybeSingle();
        tenant = memberTenant;
      }
    }

    const plan = tenant?.prospection_plan ?? "freemium";

    // Paid plans — no trial limit
    if (plan === "pro" || plan === "enterprise") {
      return NextResponse.json({ daysLeft: 999, plan, isExpired: false }, {
        headers: { "Cache-Control": "private, max-age=300" },
      });
    }

    // Check trial_ends_at first (manual override)
    if (tenant?.trial_ends_at) {
      const trialEnd = new Date(tenant.trial_ends_at);
      const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      return NextResponse.json({ daysLeft, plan });
    }

    // Fallback: compute from user creation date
    if (!createdAt) {
      return NextResponse.json({ daysLeft: TRIAL_DAYS, plan });
    }

    const elapsed = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - elapsed));

    return NextResponse.json({ daysLeft, plan });
  } catch {
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "error" });
  }
}
