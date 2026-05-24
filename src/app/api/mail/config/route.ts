/**
 * /api/mail/config — gère la config SMTP du tenant (page /settings/mail).
 *
 * GET  : lit la config (vue publique, password masqué).
 * PUT  : upsert host/port/username/(password)/tls/fromEmail/fromName.
 *        Si password absent du body, on garde l'existant (rotation hors password).
 *
 * Rate limit : 20 PUT / min par user — protège contre les retries en boucle
 * qui flusheraient l'audit log.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  getMailConfigPublic,
  upsertMailConfig,
} from "@/lib/mail/queries";

const upsertSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(320),
  /** Optionnel : si absent, on conserve le password existant. */
  password: z.string().min(1).max(512).optional(),
  tls: z.boolean(),
  fromEmail: z.string().email().max(320),
  fromName: z.string().max(120).nullable(),
});

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const cfg = await getMailConfigPublic(tenantId);
  return NextResponse.json(
    cfg ?? {
      host: null,
      port: null,
      username: null,
      tls: true,
      fromEmail: null,
      fromName: null,
      passwordConfigured: false,
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
    },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (isRateLimited(`mail-config:${auth.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const tenantId = await getTenantId(auth.user.id);
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const cfg = await upsertMailConfig(tenantId, parsed.data);
    await logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.user.id,
      action: "mail.config_updated",
      metadata: {
        host: parsed.data.host,
        port: parsed.data.port,
        passwordRotated: parsed.data.password !== undefined,
      },
    });
    return NextResponse.json(cfg);
  } catch (err) {
    console.error("[mail/config PUT] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
