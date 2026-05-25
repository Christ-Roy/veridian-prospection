/**
 * /api/mail/test-imap-connection — POST.
 *
 * Bouton "Tester la connexion" dans /settings/mail onglet IMAP. Lance
 * un connect + open mailbox sans fetcher de mail. Enregistre le résultat
 * dans tenant_mail_config.imap_last_sync_*.
 *
 * Body peut contenir des credentials override (test avant save). Sinon
 * on prend ceux en DB.
 *
 * Rate limit : 10 / min par user (handshake IMAP coûte une vraie connexion).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import {
  getImapConfigInternal,
  recordImapSyncResult,
} from "@/lib/mail/queries";
import { testImapConnection } from "@/lib/mail/imap-client";
import { encryptPassword } from "@/lib/crypto/encrypt-password";

const bodySchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(320).optional(),
  password: z.string().min(1).max(512).optional(),
  tls: z.boolean().optional(),
  folder: z.string().min(1).max(64).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`imap-test:${auth.ctx.userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const override = parsed.data;
  const stored = await getImapConfigInternal(auth.ctx.tenantId);

  let passwordEnc: string | null = null;
  if (override.password) {
    try {
      passwordEnc = encryptPassword(override.password);
    } catch (err) {
      return NextResponse.json(
        {
          error: "Encryption failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  } else if (stored) {
    passwordEnc = stored.passwordEnc;
  }

  if (!passwordEnc) {
    return NextResponse.json(
      { ok: false, reason: "missing_credentials" },
      { status: 200 },
    );
  }

  const creds = {
    host: override.host ?? stored?.host ?? "",
    port: override.port ?? stored?.port ?? 0,
    username: override.username ?? stored?.username ?? "",
    passwordEnc,
    tls: override.tls ?? stored?.tls ?? true,
    folder: override.folder ?? stored?.folder ?? "INBOX",
  };

  const result = await testImapConnection(creds);

  if (stored) {
    try {
      await recordImapSyncResult(auth.ctx.tenantId, {
        status: result.ok ? "ok" : result.reason ?? "unknown",
        error: result.ok ? null : result.errorMessage ?? null,
      });
    } catch (err) {
      console.warn("[mail/test-imap-connection] recordImapSyncResult failed:", err);
    }
  }

  return NextResponse.json(result);
}
