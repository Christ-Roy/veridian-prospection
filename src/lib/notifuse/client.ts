/**
 * Client Notifuse minimal pour Prospection.
 *
 * Best-effort, non-bloquant : utilisé pour envoyer le mail d'invitation
 * via Notifuse (POST /api/transactional.send) sans jamais faire échouer
 * le call parent (createInvitation reste OK même si Notifuse 503 / 404 /
 * timeout). C'est l'admin (UI /admin/invitations) qui reste le filet de
 * sécurité : si emailSent=false, il copie-colle l'inviteUrl.
 *
 * Auth : Bearer <jwt apiKey> — le notifuseApiKey est un JWT signé par
 * Notifuse, stocké par tenant dans tenants.notifuse_api_key (cf
 * veridian-hub/lib/notifuse/client.ts apiKeyRequest pattern).
 *
 * Workspace scoping : un workspace Notifuse = un tenant Prospection.
 * Le workspace_id Notifuse = notifuseWorkspaceSlug du tenant.
 *
 * Template : le template "invitation-prospection" doit être pré-provisionné
 * côté Notifuse dans chaque workspace (ticket
 * notifuse-veridian/todo/2026-05-23-import-template-invitation-prospection.md).
 * Si absent → 400 / 404 → emailSent=false, l'admin copie-colle.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export interface SendInvitationInput {
  /** Workspace Notifuse cible = notifuseWorkspaceSlug du tenant. */
  workspaceId: string;
  /** JWT api_key du tenant (Bearer). */
  apiKey: string;
  /** Email du destinataire (lowercased en amont). */
  toEmail: string;
  /** Variables Liquid du template invitation-prospection. */
  vars: {
    inviter_email: string;
    workspace_name: string;
    invite_url: string;
    /** ISO date string lisible côté Liquid (DateTime → toISOString()). */
    expires_at: string;
  };
  /** ID idempotence (token invitation : 1 token = 1 send). */
  externalId?: string;
}

export interface SendInvitationResult {
  ok: boolean;
  /** ID Notifuse du message envoyé (présent si ok=true). */
  messageId?: string;
  /** Code court pour logs / observabilité quand ok=false. */
  reason?:
    | "missing_url"
    | "missing_credentials"
    | "missing_workspace"
    | "missing_template"
    | "auth_failed"
    | "http_error"
    | "timeout"
    | "network_error";
  /** Status HTTP brut (si on a eu une réponse). */
  status?: number;
}

/** Lit l'URL de l'API Notifuse depuis l'env (https://notifuse.app.veridian.site
 *  en prod, https://notifuse.staging.veridian.site en staging). */
function getNotifuseUrl(): string | null {
  const url = process.env.NOTIFUSE_URL?.trim();
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

/**
 * Envoie le mail d'invitation Prospection via Notifuse.
 *
 * BEST-EFFORT — ne throw jamais. Toujours retourne un résultat structuré
 * que createInvitation traduit en emailSent: bool.
 */
export async function sendInvitationEmail(
  input: SendInvitationInput,
): Promise<SendInvitationResult> {
  const url = getNotifuseUrl();
  if (!url) {
    return { ok: false, reason: "missing_url" };
  }
  if (!input.apiKey) {
    return { ok: false, reason: "missing_credentials" };
  }
  if (!input.workspaceId) {
    return { ok: false, reason: "missing_workspace" };
  }

  const body = {
    workspace_id: input.workspaceId,
    notification: {
      id: "invitation-prospection",
      external_id: input.externalId,
      contact: { email: input.toEmail },
      data: input.vars,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/api/transactional.send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const json = (await response.json().catch(() => ({}))) as {
        message_id?: string;
      };
      return { ok: true, messageId: json.message_id, status: response.status };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "auth_failed", status: response.status };
    }
    // Notifuse renvoie 400 avec message "not found" ou "not active" quand
    // le template n'existe pas dans le workspace (cf transactional_handler.go
    // handleSend). On distingue pour le log.
    if (response.status === 400 || response.status === 404) {
      const text = await response.text().catch(() => "");
      if (text.includes("not found") || text.includes("not active")) {
        return {
          ok: false,
          reason: "missing_template",
          status: response.status,
        };
      }
    }
    return { ok: false, reason: "http_error", status: response.status };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network_error" };
  }
}
