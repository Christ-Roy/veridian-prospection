/**
 * /api/mail/test-connection — POST.
 *
 * Bouton "Tester la connexion" dans /settings/mail. Lance un `verify()`
 * nodemailer (handshake + auth) sans envoyer de mail. Enregistre le
 * résultat dans tenant_mail_config.last_test_*.
 *
 * Le body peut contenir des credentials override (cas "je teste avant
 * de save"). Sinon on prend ceux en DB.
 *
 * Rate limit : 10 / min par user — un verify SMTP coûte une vraie
 * connexion, on ne veut pas spammer le serveur du tenant.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { isRateLimited } from "@/lib/rate-limit";
import {
  getMailConfigInternal,
  recordTestResult,
} from "@/lib/mail/queries";
import { testConnection } from "@/lib/mail/smtp";
import { encryptPassword } from "@/lib/crypto/encrypt-password";

const bodySchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(320).optional(),
  password: z.string().min(1).max(512).optional(),
  tls: z.boolean().optional(),
  fromEmail: z.string().email().max(320).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (isRateLimited(`mail-test:${auth.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
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
  const stored = await getMailConfigInternal(tenantId);

  // Si un password est fourni dans le body, on l'utilise (test avant save).
  // Sinon on fallback au passwordEnc en DB.
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
    fromEmail: override.fromEmail ?? stored?.fromEmail ?? "",
    fromName: stored?.fromName ?? null,
  };

  const result = await testConnection(creds);

  // Si le tenant a déjà une row, on persiste le résultat. Sinon (test "à
  // froid" avant save), on ne crée pas la row — l'upsert viendra avec PUT.
  if (stored) {
    try {
      await recordTestResult(
        tenantId,
        result.ok ? "ok" : result.reason ?? "unknown",
        result.ok ? null : result.errorMessage ?? null,
      );
    } catch (err) {
      console.warn("[mail/test-connection] recordTestResult failed:", err);
    }
  }

  return NextResponse.json(result);
}
