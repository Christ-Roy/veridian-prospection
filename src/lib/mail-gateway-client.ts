/**
 * Client sortant Prospection → Hub : `POST /api/mail/send-as-user`.
 *
 * Mail Gateway v1 — l'utilisateur Prospection envoie ses mails outreach
 * depuis SON Gmail (OAuth user) au lieu d'un SMTP BYO. Le Hub porte la
 * couche provider (Gmail API), Prospection lui délègue l'envoi via HMAC.
 *
 * Différenciateur produit Veridian vs Apollo/Cognism/Lusha : la
 * délivrabilité du commercial reste **son** problème (SPF/DKIM de son
 * domaine), pas un sender Veridian banni instantanément.
 *
 * Voir contrat complet : `veridian-hub/docs/CONTRAT-MAIL.md` v1.0.
 *
 * String canonique HMAC sortant (Pattern A §6.1) :
 *
 *     `${timestamp_ms}.${rawBody}`
 *
 * Headers obligatoires :
 *     x-veridian-app: prospection
 *     x-veridian-timestamp: <epoch ms>
 *     x-veridian-hub-signature: <hex hmac_sha256(secret, sig)>
 *     Content-Type: application/json
 *
 * Secret : `PROSPECTION_HUB_API_SECRET` (canonique cross-app, partagé avec
 * billing-state, checkout-from-app, etc. — pas de nouveau secret par scope).
 *
 * Best-effort strict : retourne un discriminated union plutôt que de throw.
 * Le caller (route /api/mail/send) décide de l'UX (502 ou code spécifique).
 */
import { createHmac, createHash, randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
const CONTRACT_VERSION = "1.0" as const;

export interface SendMailViaHubParams {
  /** hub_user_id du commercial qui envoie (l'OAuth Gmail est stocké côté Hub). */
  userId: string;
  to: string | string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  cc?: string[];
  bcc?: string[];
  /** Souvent l'email du commercial. */
  replyTo?: string;
  /** UUID v4 stable par envoi — un retry du worker ne double-envoie jamais. */
  idempotencyKey: string;
}

export type SendMailViaHubFailureReason =
  | "needs_reauth"
  | "provider_not_linked"
  | "rate_limit"
  | "user_not_found"
  | "provider_unreachable"
  | "invalid_payload"
  | "invalid_hmac"
  | "hub_misconfigured"
  | "hub_timeout"
  | "hub_network"
  | "hub_server_error"
  | "hub_invalid_response";

export type SendMailViaHubResult =
  | {
      ok: true;
      messageId: string;
      sentAt: Date;
      idempotentReplay: boolean;
    }
  | {
      ok: false;
      reason: SendMailViaHubFailureReason;
      httpStatus: number;
      message?: string;
    };

function getHubUrl(): string | null {
  return process.env.HUB_API_URL || null;
}

function getMailGatewaySecret(): string | null {
  // Canonique CONTRAT-HUB §6.1 — secret par app, partagé entre tous les
  // scopes Hub↔app (billing, mail, etc.). Pas de nouveau secret par flow.
  return (
    process.env.PROSPECTION_HUB_API_SECRET ||
    process.env.HUB_API_SECRET ||
    null
  );
}

function reasonFromHubError(code: string | undefined): SendMailViaHubFailureReason {
  switch (code) {
    case "needs_reauth":
      return "needs_reauth";
    case "provider_not_linked":
      return "provider_not_linked";
    case "rate_limit":
      return "rate_limit";
    case "user_not_found":
      return "user_not_found";
    case "provider_unreachable":
      return "provider_unreachable";
    case "invalid_hmac":
    case "secret_not_configured":
      return "invalid_hmac";
    case "invalid_payload":
    case "invalid_json":
      return "invalid_payload";
    default:
      return "hub_server_error";
  }
}

/**
 * Construit un idempotency_key déterministe pour qu'un retry envoi
 * (worker batch, retry user) ne double-envoie jamais le même mail.
 *
 * Pour un envoi 1-to-1 unique sans contexte campagne (cas bouton "Envoyer
 * mail" depuis fiche prospect), on accepte un UUID v4 frais — le caller
 * fournit son propre key.
 *
 * Pour une campagne / sequence step : le caller passe par
 * `deterministicIdempotencyKey(campaignId, recipient, step)` ci-dessous.
 */
export function deterministicIdempotencyKey(
  campaignId: string,
  recipientEmail: string,
  sequenceStep: number,
): string {
  // UUID v5-style déterministe via sha1(namespace + name). On garde une
  // forme UUID v4 valide (la zod côté Hub valide `z.string().uuid()`) en
  // forçant les bits version/variant.
  const namespace = "veridian-prospection-mail";
  const name = `${namespace}:${campaignId}:${recipientEmail.toLowerCase()}:${sequenceStep}`;
  const hash = createHash("sha1").update(name).digest("hex");
  // Format UUID : xxxxxxxx-xxxx-4xxx-Yxxx-xxxxxxxxxxxx (4 = version, Y = 8/9/a/b variant)
  const bytes = hash.slice(0, 32).split("");
  bytes[12] = "4"; // version 4
  const variantNibble = parseInt(bytes[16]!, 16);
  bytes[16] = ((variantNibble & 0x3) | 0x8).toString(16); // variant 10xx
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Génère un UUID v4 fresh (cas envoi natif 1-to-1 sans campagne). */
export function freshIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Envoie un mail via le Hub Mail Gateway au nom de l'utilisateur (Gmail OAuth).
 *
 * @param params  Le payload du mail + identité user Hub + idempotency key.
 * @param opts    Options réseau (timeout custom, override URL/secret pour tests).
 */
export async function sendMailViaHub(
  params: SendMailViaHubParams,
  opts: {
    timeoutMs?: number;
    /** Override pour tests — sinon lu sur process.env. */
    hubUrl?: string;
    /** Override pour tests — sinon lu sur process.env. */
    secret?: string;
    /** Override fetch pour tests. */
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SendMailViaHubResult> {
  const url = opts.hubUrl ?? getHubUrl();
  const secret = opts.secret ?? getMailGatewaySecret();
  if (!url || !secret) {
    return {
      ok: false,
      reason: "hub_misconfigured",
      httpStatus: 0,
      message: "HUB_API_URL or PROSPECTION_HUB_API_SECRET not configured",
    };
  }

  if (!params.bodyText && !params.bodyHtml) {
    return {
      ok: false,
      reason: "invalid_payload",
      httpStatus: 0,
      message: "Either bodyText or bodyHtml is required",
    };
  }

  const payload: Record<string, unknown> = {
    user_id: params.userId,
    to: params.to,
    subject: params.subject,
    idempotency_key: params.idempotencyKey,
    contract_version: CONTRACT_VERSION,
  };
  if (params.bodyText) payload.body_text = params.bodyText;
  if (params.bodyHtml) payload.body_html = params.bodyHtml;
  if (params.cc && params.cc.length > 0) payload.cc = params.cc;
  if (params.bcc && params.bcc.length > 0) payload.bcc = params.bcc;
  if (params.replyTo) payload.reply_to = params.replyTo;

  const body = JSON.stringify(payload);
  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const fullUrl = `${url.replace(/\/$/, "")}/api/mail/send-as-user`;
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetchFn(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-veridian-app": "prospection",
        "x-veridian-timestamp": String(timestamp),
        "x-veridian-hub-signature": signature,
      },
      body,
      signal: controller.signal,
    });

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Hub doit toujours répondre JSON — réponse non-JSON = comportement cassé.
      return {
        ok: false,
        reason: "hub_invalid_response",
        httpStatus: res.status,
        message: "Hub response was not valid JSON",
      };
    }

    if (res.ok) {
      const obj = (data ?? {}) as Record<string, unknown>;
      const messageId = obj.message_id;
      const sentAtStr = obj.sent_at;
      if (typeof messageId !== "string" || typeof sentAtStr !== "string") {
        return {
          ok: false,
          reason: "hub_invalid_response",
          httpStatus: res.status,
          message: "Missing message_id or sent_at in Hub response",
        };
      }
      const sentAt = new Date(sentAtStr);
      if (Number.isNaN(sentAt.getTime())) {
        return {
          ok: false,
          reason: "hub_invalid_response",
          httpStatus: res.status,
          message: `Invalid sent_at format: ${sentAtStr}`,
        };
      }
      return {
        ok: true,
        messageId,
        sentAt,
        idempotentReplay: obj.idempotent_replay === true,
      };
    }

    const errObj = (data ?? {}) as Record<string, unknown>;
    const errCode = typeof errObj.error === "string" ? errObj.error : undefined;
    const errMessage =
      typeof errObj.message === "string"
        ? errObj.message
        : typeof errObj.reason === "string"
          ? errObj.reason
          : undefined;
    return {
      ok: false,
      reason: reasonFromHubError(errCode),
      httpStatus: res.status,
      message: errMessage,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return {
        ok: false,
        reason: "hub_timeout",
        httpStatus: 0,
        message: `Timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      };
    }
    return {
      ok: false,
      reason: "hub_network",
      httpStatus: 0,
      message: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
