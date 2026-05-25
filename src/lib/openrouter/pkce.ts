/**
 * OpenRouter OAuth PKCE — flow de link user.
 *
 * Spec : https://openrouter.ai/docs/use-cases/oauth-pkce
 *
 *   1. UI clique "Connecter mon compte OpenRouter"
 *      → GET /api/integrations/openrouter/connect
 *      → on génère verifier + challenge S256, on stocke verifier + state
 *        dans un cookie HTTP-only signé, et on redirect openrouter.ai/auth
 *   2. L'utilisateur valide chez OpenRouter
 *      → redirect callback?code=<...>&state=<...>
 *   3. GET /api/integrations/openrouter/callback
 *      → on vérifie state (CSRF), on exchange code+verifier contre
 *        une clé API user-controlled (sk-or-v1-...), on chiffre AES-256-GCM,
 *        on stocke dans user_openrouter_link, on redirect /settings/mail?ai=connected
 *
 * Pourquoi PKCE et pas client_secret : OpenRouter ne distribue pas de client
 * confidentiel (pas d'inscription d'app à enregistrer). PKCE permet de signer
 * la requête sans secret pré-partagé — code_verifier est random côté nous,
 * code_challenge = SHA256(verifier) est envoyé à l'autorisation, et la
 * vérification a lieu à l'échange.
 */
import { createHash, randomBytes } from "node:crypto";

const AUTHORIZE_URL = "https://openrouter.ai/auth";
const TOKEN_URL = "https://openrouter.ai/api/v1/auth/keys";

/** RFC 7636 §4.1 — verifier = 43-128 chars, alphabet [A-Za-z0-9-._~]. */
export function generateCodeVerifier(): string {
  // 32 bytes random → 43 chars base64url (sans padding) = conforme RFC.
  return base64UrlEncode(randomBytes(32));
}

/** RFC 7636 §4.2 — challenge = base64url(SHA256(verifier)) pour method S256. */
export function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

/** State CSRF — random 16 bytes en base64url, conservé en cookie + comparé au callback. */
export function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

/** Encode un Buffer en base64url (RFC 4648 §5, sans padding). */
function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Construit l'URL de redirection vers openrouter.ai/auth. */
export function buildAuthorizeUrl(params: {
  callbackUrl: string;
  codeChallenge: string;
  state: string;
}): string {
  const qs = new URLSearchParams({
    callback_url: params.callbackUrl,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    state: params.state,
  });
  return `${AUTHORIZE_URL}?${qs.toString()}`;
}

export interface ExchangeResult {
  /** Clé API utilisateur (sk-or-v1-...) — débite le crédit du compte connecté. */
  key: string;
  /** Le user_id OpenRouter — pas systématiquement retourné, conservé si présent. */
  userId?: string;
}

/**
 * Échange le code OAuth contre une clé API user-controlled.
 *
 * Throw avec un kind classifié pour que la route appelante mappe vers le
 * bon status HTTP (auth=401, server=502, invalid=400).
 */
export class OpenRouterPkceError extends Error {
  constructor(
    public readonly kind: "auth" | "server" | "invalid" | "network",
    message: string,
    public readonly statusFromProvider?: number,
  ) {
    super(message);
    this.name = "OpenRouterPkceError";
  }
}

export async function exchangeCodeForKey(params: {
  code: string;
  codeVerifier: string;
}): Promise<ExchangeResult> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: params.code,
        code_verifier: params.codeVerifier,
        code_challenge_method: "S256",
      }),
    });
  } catch (err) {
    throw new OpenRouterPkceError(
      "network",
      `OpenRouter token exchange network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const kind =
      res.status === 401 || res.status === 403
        ? "auth"
        : res.status >= 500
          ? "server"
          : "invalid";
    throw new OpenRouterPkceError(
      kind,
      `OpenRouter ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json().catch(() => ({}))) as {
    key?: string;
    user_id?: string;
  };
  if (!data.key || typeof data.key !== "string" || !data.key.startsWith("sk-or-")) {
    throw new OpenRouterPkceError(
      "server",
      "OpenRouter exchange returned no usable key",
    );
  }
  return { key: data.key, userId: data.user_id };
}
