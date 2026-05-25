/**
 * /api/mail/send — POST.
 *
 * Envoie un mail depuis la fiche lead (bouton "Envoyer un mail").
 *
 * Routage dynamique : on interroge le Hub (HMAC, cache 5 min en mémoire)
 * pour savoir si l'utilisateur a un compte Gmail OAuth lié.
 *
 *   1. Gmail OAuth lié côté Hub → envoi via Hub Mail Gateway (le mail
 *      part du Gmail OAuth du commercial — différenciateur produit
 *      Veridian, cf veridian-hub/docs/CONTRAT-MAIL.md v1.0).
 *
 *   2. Sinon → envoi SMTP BYO via TenantMailConfig (host/port/user/
 *      passwordEnc). Comportement inchangé pour tous les tenants existants.
 *
 * Si `templateSlug` est fourni, on rend le template avec les variables
 * `prospect.{name,entreprise}` + `sender.{name,email}` puis on envoie.
 * Sinon le compose libre {subject, bodyText, bodyHtml} est utilisé tel quel.
 *
 * Trace toujours côté DB (`lead_emails`) — sent OR failed — pour alimenter
 * la timeline 360 et la future page /history mails.
 *
 * Rate limit : 30 mails / 5 min par user — quel que soit le provider, on cap
 * pour éviter qu'un bug UI ne spam.
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
import { renderTemplate, type TemplateVars } from "@/lib/mail/templates";
import { resolveTemplate } from "@/lib/mail/tenant-templates";
import { enqueueMail } from "@/lib/mail/outbox";
import {
  sendMailViaHub,
  freshIdempotencyKey,
  checkHubMailProviderStatus,
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
     * Idempotency key optionnel — si fourni le caller dédup (cas worker
     * batch / sequence step). Sinon on génère un UUID v4 frais (cas envoi
     * 1-to-1 ad-hoc depuis la fiche prospect).
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
      return { status: 502, reason: hubStatus >= 500 ? "hub_server_error" : "provider_unreachable" };
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

  // Source de vérité = Hub (pas une colonne workspace DB). On résout
  // d'abord hubUserId puis on demande au Hub si l'user a un Gmail OAuth lié.
  // Cache 5 min en mémoire pour éviter 1 HMAC roundtrip à chaque envoi.
  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { hubUserId: true, email: true, name: true },
  });
  const hasGmailOauthLinked = user?.hubUserId
    ? await checkHubMailProviderStatus(user.hubUserId)
    : false;

  // ─── Branche Hub Mail Gateway (Gmail OAuth user) ──────────────────────
  if (hasGmailOauthLinked && user?.hubUserId) {
    return sendViaHubGateway({
      auth: auth.user,
      tenantId,
      workspaceId,
      input,
      user: { hubUserId: user.hubUserId, email: user.email, name: user.name },
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

  // Enqueue dans mail_outbox + lead_emails(queued) en MÊME transaction.
  // Le cron /api/cron/mail-outbox-flush prendra le relais pour l'envoi
  // réel + retry exponential. UI rend instantanément.
  try {
    const enqueueResult = await prisma.$transaction(async (tx) => {
      return enqueueMail(tx, {
        tenantId,
        userId: auth.user.id,
        workspaceId,
        idempotencyKey: input.idempotencyKey,
        payload: {
          to: input.to,
          cc: input.cc,
          subject,
          bodyText,
          bodyHtml,
          templateSlug: input.templateSlug ?? null,
          siren: input.siren ?? null,
          provider: "smtp",
          fromEmail: creds.fromEmail,
          fromName: creds.fromName,
        },
      });
    });

    await logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.user.id,
      action: "mail.queued",
      targetType: "prospect",
      targetId: input.siren ?? null,
      metadata: {
        to: input.to,
        templateSlug: input.templateSlug ?? null,
        outboxId: enqueueResult.outboxId,
        leadEmailId: enqueueResult.leadEmailId,
        idempotencyKey: enqueueResult.idempotencyKey,
        alreadyEnqueued: enqueueResult.alreadyEnqueued,
        provider: "smtp",
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "queued",
        outboxId: enqueueResult.outboxId,
        leadEmailId: enqueueResult.leadEmailId,
        idempotencyKey: enqueueResult.idempotencyKey,
        alreadyEnqueued: enqueueResult.alreadyEnqueued,
      },
      { status: 202 },
    );
  } catch (err) {
    console.error("[mail/send] enqueue failed:", err);
    // Trace l'échec d'enqueue pour debug (rare : DB indisponible, etc.).
    await recordFailedEmail({
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
      messageId: `failed-${randomUUID()}`,
      errorMessage: `enqueue_failed: ${err instanceof Error ? err.message : String(err)}`,
    }).catch(() => {});
    return NextResponse.json(
      {
        ok: false,
        reason: "enqueue_failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
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
  user: { hubUserId: string; email: string; name: string | null };
}): Promise<NextResponse> {
  const { auth, tenantId, workspaceId, input, user } = args;

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
