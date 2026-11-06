/**
 * Middleware d'auth HMAC Hub pour les routes contrat §5.
 *
 * Wrapper standard pour les nouveaux endpoints (attach-owner, suspend, resume,
 * health, update-plan, soft-delete, restore, purge, usage-summary).
 *
 * Standard-only : le Hub signe tous ses appels en HMAC §6.1, aucun mode legacy.
 *
 * Usage :
 *
 *   const auth = await requireHubHmac(request);
 *   if (!auth.ok) return auth.response;
 *   const body = auth.body;  // déjà parsé en JSON
 *   const rawBody = auth.rawBody;
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyHubHmac } from "./hmac";

function getSecret(): string | undefined {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
}

export type HubHmacAuthResult<TBody = unknown> =
  | {
      ok: true;
      body: TBody;
      rawBody: string;
      mode: "standard";
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

  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
