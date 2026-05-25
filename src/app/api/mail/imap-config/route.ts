/**
 * /api/mail/imap-config — gère la config IMAP du tenant (page /settings/mail).
 *
 * GET    : lit la config (vue publique, password masqué).
 * PUT    : upsert host/port/username/(password)/tls/folder.
 *          Si password absent du body, on garde l'existant (rotation hors password).
 * DELETE : efface complètement les credentials IMAP — désactive le cron pour ce tenant.
 *
 * RBAC : admin only — la config mail est un secret stratégique du tenant,
 * pas un réglage individuel.
 *
 * Rate limit : 20 PUT / min par user (même politique que SMTP).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  clearImapConfig,
  getImapConfigPublic,
  upsertImapConfig,
} from "@/lib/mail/queries";

const upsertSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(320),
  /** Optionnel : si absent, on conserve le password existant. */
  password: z.string().min(1).max(512).optional(),
  tls: z.boolean(),
  folder: z.string().min(1).max(64).default("INBOX"),
});

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const cfg = await getImapConfigPublic(auth.ctx.tenantId);
  return NextResponse.json(
    cfg ?? {
      host: null,
      port: null,
      username: null,
      tls: true,
      folder: "INBOX",
      passwordConfigured: false,
      lastUidSeen: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
    },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`imap-config:${auth.ctx.userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
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
    const cfg = await upsertImapConfig(auth.ctx.tenantId, parsed.data);
    await logAudit({
      tenantId: auth.ctx.tenantId,
      actorType: "user",
      actorId: auth.ctx.userId,
      action: "mail.imap_config_updated",
      metadata: {
        host: parsed.data.host,
        port: parsed.data.port,
        folder: parsed.data.folder,
        passwordRotated: parsed.data.password !== undefined,
      },
    });
    return NextResponse.json(cfg);
  } catch (err) {
    console.error("[mail/imap-config PUT] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    await clearImapConfig(auth.ctx.tenantId);
    await logAudit({
      tenantId: auth.ctx.tenantId,
      actorType: "user",
      actorId: auth.ctx.userId,
      action: "mail.imap_config_cleared",
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[mail/imap-config DELETE] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
