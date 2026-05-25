/**
 * /api/admin/mail-templates — CRUD templates customs par tenant (admin only).
 *
 * Cf ticket follow-ups §A + migration 0029 + lib/mail/tenant-templates.ts.
 *
 * GET  : liste les templates customs du tenant (non soft-deleted).
 * POST : crée un template — slug doit être unique parmi les non-soft-deleted.
 *
 * Auth : requireAdmin (RBAC resource.update.any). Membres consomment
 * /api/mail/templates pour leur dropdown compose.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import {
  listCustomTemplates,
  createTenantTemplate,
  TenantTemplateConflictError,
} from "@/lib/mail/tenant-templates";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  // lowercase, alphanum + tirets / underscores, 3-64 chars.
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, {
      message: "Slug must be lowercase, alphanumeric, with -/_ separators",
    }),
  label: z.string().min(1).max(120),
  subject: z.string().min(1).max(500),
  bodyText: z.string().min(1).max(50_000),
  bodyHtml: z.string().min(1).max(100_000),
  variables: z.array(z.string().max(64)).max(50).optional(),
});

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const templates = await listCustomTemplates(auth.ctx.tenantId);
  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`mail-tpl-create:${auth.ctx.userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const tpl = await createTenantTemplate(auth.ctx.tenantId, parsed.data);
    await logAudit({
      tenantId: auth.ctx.tenantId,
      actorType: "user",
      actorId: auth.ctx.userId,
      action: "mail.template_created",
      targetType: "mail_template",
      targetId: tpl.id,
      metadata: {
        slug: tpl.slug,
        label: tpl.label,
      },
    });
    return NextResponse.json({ template: tpl }, { status: 201 });
  } catch (err) {
    if (err instanceof TenantTemplateConflictError) {
      return NextResponse.json(
        { error: "Slug already exists", slug: err.slug },
        { status: 409 },
      );
    }
    console.error("[admin/mail-templates POST] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
