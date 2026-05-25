/**
 * /api/mail/send — POST.
 *
 * Envoie un mail depuis la fiche lead (bouton "Envoyer un mail").
 *
 * Envoi **synchrone direct** — pas de queue. Le commercial envoie un
 * mail manuellement depuis la fiche prospect ; un appel HTTP simple
 * SMTP / Hub Gateway est largement suffisant à notre échelle (cf
 * Twenty CRM, qui marche pareil). La queue mail_outbox livrée W9c F a
 * été revertée 2026-05-26 (sur-ingénierie).
 *
 * Deux flows selon `workspace.mail_provider` :
 *
 *   1. `mail_provider === 'gmail-via-hub'` (migration 0025) → envoi
 *      via Hub Mail Gateway : le mail part du Gmail OAuth du commercial.
 *      Différenciateur produit Veridian (cf ticket
 *      2026-05-25-mail-send-as-user-via-hub-gateway.md).
 *
 *   2. `mail_provider === 'none'` (default, v1) → envoi SMTP BYO via
 *      TenantMailConfig (host/port/user/passwordEnc).
 *
 * Si `templateSlug` est fourni, on rend le template (custom tenant OR
 * fallback hardcodé) avec les variables `prospect.{name,entreprise}`
 * + `sender.{name,email}` puis on envoie. Sinon le compose libre
 * {subject, bodyText, bodyHtml} est utilisé tel quel.
 *
 * Si une signature commerciale est configurée + activée
 * (`tenant_mail_config.mail_signature_*`, migration 0030), elle est
 * append au body AVANT l'envoi.
 *
 * Trace toujours côté DB (`lead_emails`) — sent OR failed — pour
 * alimenter la timeline 360.
 *
 * Rate limit : 30 mails / 5 min par user — quel que soit le provider,
 * on cap pour éviter qu'un bug UI ne spam.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { getWorkspaceScope } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import {
  getMailConfigInternal,
  recordSentEmail,
  recordFailedEmail,
} from "@/lib/mail/queries";
import { sendMail } from "@/lib/mail/smtp";
import { renderTemplate, type TemplateVars } from "@/lib/mail/templates";
import { resolveTemplate } from "@/lib/mail/tenant-templates";
import { applySignatureIfEnabled } from "@/lib/mail/signature";
import {
  sendMailViaHub,
  freshIdempotencyKey,
  type SendMailViaHubFailureReason,
} from "@/lib/mail-gateway-client";
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
    /**
     * Idempotency key optionnel — utilisé uniquement par la branche
     * Hub Gateway (le Hub dédoublonne côté Gmail). Sinon UUID frais.
     */
    idempotencyKey: z.string().uuid().optional(),
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

/**
 * Map les reasons Hub vers le triplet (httpStatus, code clair UI).
 * 412 needs_reauth et 422 provider_not_linked = STOP campagne côté UI.
 */
function mapHubFailureToHttp(
  reason: SendMailViaHubFailureReason,
  hubStatus: number,
): { status: number; reason: string } {
  switch (reason) {
    case "needs_reauth":
      return { status: 412, reason: "needs_reauth" };
    case "provider_not_linked":
      return { status: 422, reason: "provider_not_linked" };
    case "user_not_found":
      return { status: 404, reason: "user_not_found" };
    case "rate_limit":
      return { status: 429, reason: "rate_limit" };
    case "invalid_payload":
      return { status: 400, reason: "invalid_payload" };
    case "invalid_hmac":
    case "hub_misconfigured":
      return { status: 503, reason: "hub_misconfigured" };
    case "hub_timeout":
    case "hub_network":
    case "provider_unreachable":
      return { status: 502, reason: "provider_unreachable" };
    case "hub_invalid_response":
    case "hub_server_error":
    default:
      return {
        status: 502,
        reason: hubStatus >= 500 ? "hub_server_error" : "provider_unreachable",
      };
  }
}

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

  const { insertId: workspaceId } = await getWorkspaceScope();

  // Lit le mail_provider du workspace actif. Si pas de workspace résolu,
  // fallback SMTP BYO (cas legacy / tenant sans workspace member).
  const workspace = workspaceId
    ? await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          mailProvider: true,
          gmailConnectedAt: true,
        },
      })
    : null;
  const provider = workspace?.mailProvider ?? "none";

  // ─── Branche Hub Mail Gateway (Gmail OAuth user) ──────────────────────
  if (provider === "gmail-via-hub") {
    return sendViaHubGateway({
      auth: auth.user,
      tenantId,
      workspaceId,
      input,
    });
  }

  // ─── Branche SMTP BYO (v1, default) ───────────────────────────────────
  const creds = await getMailConfigInternal(tenantId);
  if (!creds) {
    return NextResponse.json(
      { error: "SMTP not configured", reason: "missing_credentials" },
      { status: 412 },
    );
  }

  // Rendu : template (custom OU fallback hardcodé) OU compose libre.
  let subject: string;
  let bodyText: string;
  let bodyHtml: string;
  if (input.templateSlug) {
    const tpl = await resolveTemplate(tenantId, input.templateSlug);
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

  // Append signature commerciale si configurée + activée (W9c §J).
  const signed = await applySignatureIfEnabled(prisma, tenantId, {
    bodyText,
    bodyHtml,
  });
  bodyText = signed.bodyText;
  bodyHtml = signed.bodyHtml;

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
        provider: "smtp",
      },
    });
    return NextResponse.json({ ok: true, messageId: result.messageId });
  }

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

/**
 * Branche Hub Mail Gateway. L'OAuth Gmail est stocké côté Hub sur
 * `user.hubUserId` — Prosp ne fait que signer HMAC et déléguer.
 */
async function sendViaHubGateway(args: {
  auth: { id: string; email: string };
  tenantId: string;
  workspaceId: string | null;
  input: z.infer<typeof sendSchema>;
}): Promise<NextResponse> {
  const { auth, tenantId, workspaceId, input } = args;

  // Résout hubUserId — sans lui, le Hub ne peut pas mapper vers l'OAuth Gmail.
  const user = await prisma.user.findUnique({
    where: { id: auth.id },
    select: { hubUserId: true, email: true, name: true },
  });
  if (!user?.hubUserId) {
    return NextResponse.json(
      {
        ok: false,
        reason: "provider_not_linked",
        message: "User has no hubUserId — cannot resolve Gmail OAuth",
      },
      { status: 422 },
    );
  }

  // Rendu (template OU compose libre). Sender = email user lui-même
  // (différenciateur : le from c'est SON adresse, pas un sender Veridian).
  let subject: string;
  let bodyText: string;
  let bodyHtml: string;
  if (input.templateSlug) {
    const tpl = await resolveTemplate(tenantId, input.templateSlug);
    if (!tpl) {
      return NextResponse.json(
        { error: "Unknown template", templateSlug: input.templateSlug },
        { status: 400 },
      );
    }
    const vars: TemplateVars = {
      prospect: input.vars!.prospect,
      sender: {
        name: user.name ?? auth.email,
        email: auth.email,
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

  // Append signature commerciale si configurée + activée (W9c §J).
  const signed = await applySignatureIfEnabled(prisma, tenantId, {
    bodyText,
    bodyHtml,
  });
  bodyText = signed.bodyText;
  bodyHtml = signed.bodyHtml;

  const idempotencyKey = input.idempotencyKey ?? freshIdempotencyKey();
  const result = await sendMailViaHub({
    userId: user.hubUserId,
    to: input.to,
    subject,
    bodyText,
    bodyHtml,
    cc: input.cc,
    replyTo: auth.email,
    idempotencyKey,
  });

  const traceBase = {
    tenantId,
    workspaceId,
    userId: auth.id,
    siren: input.siren ?? null,
    fromEmail: auth.email,
    fromName: user.name ?? null,
    toEmails: [input.to],
    ccEmails: input.cc ?? [],
    subject,
    bodyText,
    bodyHtml,
    templateSlug: input.templateSlug ?? null,
  };

  if (result.ok) {
    await recordSentEmail({
      ...traceBase,
      messageId: result.messageId,
    });
    await logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.id,
      action: "mail.sent",
      targetType: "prospect",
      targetId: input.siren ?? null,
      metadata: {
        to: input.to,
        templateSlug: input.templateSlug ?? null,
        messageId: result.messageId,
        provider: "gmail-via-hub",
        idempotentReplay: result.idempotentReplay,
      },
    });
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      provider: "gmail-via-hub",
      idempotentReplay: result.idempotentReplay,
    });
  }

  // Échec : trace + map status.
  const { status, reason } = mapHubFailureToHttp(result.reason, result.httpStatus);
  await recordFailedEmail({
    ...traceBase,
    messageId: `failed-${randomUUID()}`,
    errorMessage: result.message ?? reason,
  });
  return NextResponse.json(
    {
      ok: false,
      reason,
      provider: "gmail-via-hub",
      errorMessage: result.message,
    },
    { status },
  );
}
