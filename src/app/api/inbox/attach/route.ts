import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, getWorkspaceFilter } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { attachInboxEmail } from "@/lib/queries/inbox";

const attachSchema = z.object({
  leadEmailId: z.string().uuid(),
  siren: z.string().regex(/^\d{9}$/),
});

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`inbox-attach:${auth.ctx.userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const workspaceFilter = getWorkspaceFilter(auth.ctx);

  const result = await attachInboxEmail({
    leadEmailId: parsed.data.leadEmailId,
    siren: parsed.data.siren,
    tenantId: auth.ctx.tenantId,
    workspaceFilter,
  });

  if (!result.ok) {
    if (result.code === "not_found") {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    if (result.code === "siren_not_found") {
      return NextResponse.json(
        { error: "SIREN not found" },
        { status: 404 },
      );
    }
    if (result.code === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  await logAudit({
    tenantId: auth.ctx.tenantId,
    actorId: auth.ctx.userId,
    actorType: "user",
    action: "inbox.email_attached",
    targetType: "lead_email",
    targetId: parsed.data.leadEmailId,
    metadata: {
      siren: parsed.data.siren,
      previousSiren: result.ok ? result.previousSiren : null,
    },
  });

  return NextResponse.json({
    ok: true,
    leadEmailId: parsed.data.leadEmailId,
    siren: parsed.data.siren,
    previousSiren: result.ok ? result.previousSiren : null,
  });
}
