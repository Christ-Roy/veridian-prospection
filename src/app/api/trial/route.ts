import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/api-auth";
import { prisma } from "@/lib/prisma";

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? "7", 10);

// GET /api/trial — returns trial state from local Prisma tenants table
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (auth.user.id === "internal") {
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "internal" });
  }

  try {
    let tenant = await prisma.tenant.findFirst({
      where: { userId: auth.user.id, deletedAt: null },
      select: { prospectionPlan: true, trialEndsAt: true },
    });

    if (!tenant) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.user.id },
        include: { workspace: true },
      });
      if (membership?.workspace?.tenantId) {
        tenant = await prisma.tenant.findUnique({
          where: { id: membership.workspace.tenantId },
          select: { prospectionPlan: true, trialEndsAt: true },
        });
      }
    }

    const plan = tenant?.prospectionPlan ?? "freemium";

    if (plan === "pro" || plan === "enterprise") {
      return NextResponse.json(
        { daysLeft: 999, plan, isExpired: false },
        { headers: { "Cache-Control": "private, max-age=300" } },
      );
    }

    if (tenant?.trialEndsAt) {
      const trialEnd = tenant.trialEndsAt;
      const daysLeft = Math.max(
        0,
        Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      );
      return NextResponse.json({ daysLeft, plan, isExpired: daysLeft <= 0 });
    }

    // Pas de trial_ends_at défini → fallback fail-open
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan, isExpired: false });
  } catch (err) {
    console.warn("[/api/trial] lookup failed:", err);
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "error", isExpired: false });
  }
}
