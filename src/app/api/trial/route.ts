import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? "7", 10);

// GET /api/trial — returns trial state based on user creation date + tenant plan.
// Source de vérité : Prisma User (createdAt) + Tenant (plan). Lookup tenant
// soit direct via userId (owner), soit via workspace_members → workspace.tenantId.
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { createdAt: true },
    });
    const createdAt = user?.createdAt ?? null;

    // Lookup tenant — owner direct puis fallback membre invité
    let tenant: { plan: string | null } | null = await prisma.tenant.findFirst({
      where: { userId: auth.user.id, deletedAt: null },
      select: { plan: true },
    });

    if (!tenant) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.user.id, deletedAt: null },
        include: { workspace: { select: { tenantId: true } } },
      });
      if (membership?.workspace?.tenantId) {
        tenant = await prisma.tenant.findFirst({
          where: { id: membership.workspace.tenantId, deletedAt: null },
          select: { plan: true },
        });
      }
    }

    const plan = tenant?.plan ?? "freemium";

    // Paid plans — no trial limit
    if (plan === "pro" || plan === "enterprise") {
      return NextResponse.json(
        { daysLeft: 999, plan, isExpired: false },
        { headers: { "Cache-Control": "private, max-age=300" } },
      );
    }

    if (!createdAt) {
      return NextResponse.json({ daysLeft: TRIAL_DAYS, plan });
    }

    const elapsed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - elapsed));

    return NextResponse.json({ daysLeft, plan });
  } catch {
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "error" });
  }
}
