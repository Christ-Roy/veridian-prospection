/**
 * /api/admin/mail-templates/{templateId} — update / soft delete (admin only).
 *
 * Cf ticket follow-ups §A + lib/mail/tenant-templates.ts.
 *
 * PUT    : maj partielle (slug / label / subject / body / variables).
 * DELETE : soft delete (deleted_at = NOW()). Idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import {
  updateTenantTemplate,
  softDeleteTenantTemplate,
} from "@/lib/mail/tenant-templates";
import { logAudit } from "@/lib/audit";

const updateSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .optional(),
  label: z.string().min(1).max(120).optional(),
  subject: z.string().min(1).max(500).optional(),
  bodyText: z.string().min(1).max(50_000).optional(),
  bodyHtml: z.string().min(1).max(100_000).optional(),
  variables: z.array(z.string().max(64)).max(50).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`mail-tpl-update:${auth.ctx.userId}`, 30, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const { templateId } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const tpl = await updateTenantTemplate(auth.ctx.tenantId, templateId, parsed.data);
  if (!tpl) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await logAudit({
    tenantId: auth.ctx.tenantId,
    actorType: "user",
    actorId: auth.ctx.userId,
    action: "mail.template_updated",
    targetType: "mail_template",
    targetId: tpl.id,
    metadata: {
      slug: tpl.slug,
      label: tpl.label,
      fieldsUpdated: Object.keys(parsed.data),
    },
  });
  return NextResponse.json({ template: tpl });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { templateId } = await params;

  const ok = await softDeleteTenantTemplate(auth.ctx.tenantId, templateId);
  if (!ok) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await logAudit({
    tenantId: auth.ctx.tenantId,
    actorType: "user",
    actorId: auth.ctx.userId,
    action: "mail.template_deleted",
    targetType: "mail_template",
    targetId: templateId,
    metadata: {},
  });
  return NextResponse.json({ ok: true, templateId });
}
