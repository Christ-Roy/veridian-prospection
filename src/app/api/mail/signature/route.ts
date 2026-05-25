/**
 * /api/mail/signature — gère la signature commerciale du tenant.
 *
 * Cf ticket follow-ups §J + migration 0030.
 *
 * GET : { mailSignatureHtml, mailSignatureEnabled }.
 * PUT : upsert mail_signature_html + mail_signature_enabled.
 *
 * Auth user simple (member peut éditer sa signature commerciale — pas
 * besoin d'être admin pour personnaliser ses mails commerciaux). v2
 * pourra restreindre via permission dédiée si différenciation par user
 * (signature owner-only) devient un besoin.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { isRateLimited } from "@/lib/rate-limit";
import { getMailConfigPublic, updateMailSignature } from "@/lib/mail/queries";
import { logAudit } from "@/lib/audit";

const putSchema = z.object({
  mailSignatureHtml: z.string().max(20_000).nullable(),
  mailSignatureEnabled: z.boolean(),
});

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const cfg = await getMailConfigPublic(tenantId);
  return NextResponse.json({
    mailSignatureHtml: cfg?.mailSignatureHtml ?? null,
    mailSignatureEnabled: cfg?.mailSignatureEnabled ?? true,
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (isRateLimited(`mail-sig:${auth.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const cfg = await updateMailSignature(tenantId, parsed.data);
    await logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.user.id,
      action: "mail.signature_updated",
      metadata: {
        enabled: parsed.data.mailSignatureEnabled,
        htmlLength: parsed.data.mailSignatureHtml?.length ?? 0,
      },
    });
    return NextResponse.json({
      mailSignatureHtml: cfg.mailSignatureHtml,
      mailSignatureEnabled: cfg.mailSignatureEnabled,
    });
  } catch (err) {
    console.error("[mail/signature PUT] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
