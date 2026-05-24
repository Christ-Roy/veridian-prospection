/**
 * /api/mail/send — POST.
 *
 * Envoie un mail SMTP depuis la fiche lead (bouton "Envoyer un mail").
 * Si `templateSlug` est fourni, on rend le template avec les variables
 * `prospect.{name,entreprise}` + `sender.{name,email}` puis on envoie.
 * Sinon le compose libre {subject, bodyText, bodyHtml} est utilisé tel quel.
 *
 * Trace toujours côté DB (`lead_emails`) — sent OR failed — pour alimenter
 * la timeline 360 et la future page /history mails.
 *
 * Rate limit : 30 mails / 5 min par user — l'user envoie depuis SON SMTP,
 * mais on cap pour éviter qu'un bug UI ne spam.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { getWorkspaceScope } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import {
  getMailConfigInternal,
  recordSentEmail,
  recordFailedEmail,
} from "@/lib/mail/queries";
import { sendMail } from "@/lib/mail/smtp";
import {
  getTemplate,
  renderTemplate,
  type TemplateVars,
} from "@/lib/mail/templates";
import { logAudit } from "@/lib/audit";

const sendSchema = z
  .object({
    to: z.string().email().max(320),
    cc: z.array(z.string().email().max(320)).max(20).optional(),
    siren: z.string().regex(/^\d{9}$/).optional(),
    /** Si fourni : rend le template. Sinon : compose libre. */
    templateSlug: z.string().max(64).nullable().optional(),
    /** Variables pour le rendu liquid. Requises si templateSlug. */
    vars: z
      .object({
        prospect: z.object({
          name: z.string().max(200),
          entreprise: z.string().max(200),
        }),
      })
      .optional(),
    /** Compose libre — requis si pas de templateSlug. */
    subject: z.string().min(1).max(500).optional(),
    bodyText: z.string().min(1).max(50_000).optional(),
    bodyHtml: z.string().min(1).max(100_000).optional(),
  })
  .refine(
    (d) =>
      d.templateSlug
        ? !!d.vars
        : !!(d.subject && d.bodyText && d.bodyHtml),
    {
      message:
        "Either templateSlug+vars OR (subject+bodyText+bodyHtml) is required",
    },
  );

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (isRateLimited(`mail-send:${auth.user.id}`, 30, 300_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const creds = await getMailConfigInternal(tenantId);
  if (!creds) {
    return NextResponse.json(
      { error: "SMTP not configured", reason: "missing_credentials" },
      { status: 412 },
    );
  }

  // Rendu : template OU compose libre.
  let subject: string;
  let bodyText: string;
  let bodyHtml: string;
  if (input.templateSlug) {
    const tpl = getTemplate(input.templateSlug);
    if (!tpl) {
      return NextResponse.json(
        { error: "Unknown template", templateSlug: input.templateSlug },
        { status: 400 },
      );
    }
    const vars: TemplateVars = {
      prospect: input.vars!.prospect,
      sender: {
        name: creds.fromName ?? auth.user.email,
        email: creds.fromEmail,
      },
    };
    subject = renderTemplate(tpl.subject, vars);
    bodyText = renderTemplate(tpl.bodyText, vars);
    bodyHtml = renderTemplate(tpl.bodyHtml, vars);
  } else {
    subject = input.subject!;
    bodyText = input.bodyText!;
    bodyHtml = input.bodyHtml!;
  }

  const { insertId: workspaceId } = await getWorkspaceScope();

  const result = await sendMail(creds, {
    to: input.to,
    cc: input.cc,
    subject,
    bodyText,
    bodyHtml,
  });

  const traceBase = {
    tenantId,
    workspaceId,
    userId: auth.user.id,
    siren: input.siren ?? null,
    fromEmail: creds.fromEmail,
    fromName: creds.fromName,
    toEmails: [input.to],
    ccEmails: input.cc ?? [],
    subject,
    bodyText,
    bodyHtml,
    templateSlug: input.templateSlug ?? null,
  };

  if (result.ok && result.messageId) {
    await recordSentEmail({ ...traceBase, messageId: result.messageId });
    await logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.user.id,
      action: "mail.sent",
      targetType: "prospect",
      targetId: input.siren ?? null,
      metadata: {
        to: input.to,
        templateSlug: input.templateSlug ?? null,
        messageId: result.messageId,
      },
    });
    return NextResponse.json({ ok: true, messageId: result.messageId });
  }

  // Échec : on trace quand même pour la timeline (status=failed) avec un
  // messageId synthétique pour respecter la contrainte UNIQUE.
  await recordFailedEmail({
    ...traceBase,
    messageId: `failed-${randomUUID()}`,
    errorMessage: result.errorMessage ?? result.reason ?? "unknown",
  });

  return NextResponse.json(
    {
      ok: false,
      reason: result.reason,
      smtpCode: result.smtpCode,
      errorMessage: result.errorMessage,
    },
    { status: 502 },
  );
}
