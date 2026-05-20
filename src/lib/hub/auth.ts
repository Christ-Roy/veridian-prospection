/**
 * Middleware d'auth HMAC Hub pour les routes contrat §5.
 *
 * Wrapper standard pour les nouveaux endpoints (attach-owner, suspend, resume,
 * health, update-plan, soft-delete, restore, purge, usage-summary).
 *
 * À la différence de `/api/tenants/provision` qui supporte 3 modes (standard +
 * 2 legacy) pour ne pas casser le Hub actuel, les nouveaux endpoints sont
 * **standard-only** : ils n'existaient pas avant donc rien à conserver.
 *
 * Usage :
 *
 *   const auth = await requireHubHmac(request);
 *   if (!auth.ok) return auth.response;
 *   const body = auth.body;  // déjà parsé en JSON
 *   const rawBody = auth.rawBody;
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyHubHmac, verifyLegacyBearer } from "./hmac";

function getSecret(): string | undefined {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
}

const ACCEPT_LEGACY_BEARER = process.env.ACCEPT_LEGACY_BEARER !== "0";

export type HubHmacAuthResult<TBody = unknown> =
  | {
      ok: true;
      body: TBody;
      rawBody: string;
      mode: "standard" | "legacy_bearer";
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Lit le body, vérifie le HMAC standard contrat §6.1, retourne le body parsé.
 *
 * Codes d'erreur retournés (cf §5.10 format erreurs standardisé) :
 *  - 500 `{ error: "Server misconfigured" }` si HUB_API_SECRET absent
 *  - 400 `{ error: "invalid_payload" }` si body JSON invalide
 *  - 401 `{ error: "Timestamp expired or invalid" }` si drift > 5min
 *  - 401 `{ error: "Invalid signature" }` si signature ne match pas
 *  - 401 `{ error: "Unauthorized" }` si aucun mode d'auth présent
 */
export async function requireHubHmac<TBody = unknown>(
  request: NextRequest,
): Promise<HubHmacAuthResult<TBody>> {
  const secret = getSecret();
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server misconfigured" },
        { status: 500 },
      ),
    };
  }

  const rawBody = await request.text();
  let body: TBody;
  try {
    body = (rawBody ? JSON.parse(rawBody) : {}) as TBody;
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "invalid_payload" },
        { status: 400 },
      ),
    };
  }

  // Standard HMAC contrat §6.1
  const headerSig = request.headers.get("x-veridian-hub-signature");
  const headerTs = Number(request.headers.get("x-veridian-timestamp"));

  if (headerSig) {
    const v = verifyHubHmac(secret, headerTs, rawBody, headerSig);
    if (v.ok) return { ok: true, body, rawBody, mode: "standard" };

    const status = 401;
    const error =
      v.reason === "timestamp_drift" || v.reason === "invalid_timestamp"
        ? "Timestamp expired or invalid"
        : "Invalid signature";
    return {
      ok: false,
      response: NextResponse.json({ error }, { status }),
    };
  }

  // Legacy Bearer — fenêtre Hub
  if (ACCEPT_LEGACY_BEARER) {
    const v = verifyLegacyBearer(secret, request.headers.get("authorization"));
    if (v.ok) {
      // Log explicite pour pouvoir flipper ACCEPT_LEGACY_BEARER=0 en confiance
      // après une fenêtre d'observation 7j à 0 occurrence.
      console.warn(
        `[hub-auth] legacy Bearer accepted on ${request.nextUrl.pathname} — migrate Hub to standard HMAC {ts}.{body}`,
      );
      return { ok: true, body, rawBody, mode: "legacy_bearer" };
    }
  }

  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
