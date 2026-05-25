/**
 * /api/mail/ai-config — gère la config LLM tenant (page /settings/mail onglet IA).
 *
 * GET    : lit la config (clé API JAMAIS exposée, juste un flag "configurée").
 * PUT    : upsert provider/model/(apiKey)/defaultLocale (admin only).
 * DELETE : revoke complet (admin only).
 *
 * Rate limit : 20 PUT / min par user — pareil que /api/mail/config (BYO SMTP),
 * protège contre les retries en boucle.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  getAiConfigPublic,
  upsertAiConfig,
  deleteAiConfig,
} from "@/lib/ai/queries";
import { AI_PROVIDERS } from "@/lib/ai/models";

const upsertSchema = z.object({
  provider: z.enum(AI_PROVIDERS as [string, ...string[]]),
  model: z.string().min(1).max(64),
  /** Optionnel : si absent, on conserve la clé existante. Min 8 char (toutes
   *  les clés API providers font > 8). */
  apiKey: z.string().min(8).max(512).optional(),
  defaultLocale: z.enum(["fr", "en"]).default("fr"),
});

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const cfg = await getAiConfigPublic(auth.ctx.tenantId);
  return NextResponse.json(
    cfg ?? {
      provider: null,
      model: null,
      defaultLocale: "fr",
      apiKeyConfigured: false,
      lastUsedAt: null,
      totalTokensIn: 0,
      totalTokensOut: 0,
    },
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`ai-config:${auth.ctx.userId}`, 20, 60_000)) {
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
    const cfg = await upsertAiConfig(auth.ctx.tenantId, {
      provider: parsed.data.provider as Parameters<typeof upsertAiConfig>[1]["provider"],
      model: parsed.data.model,
      apiKey: parsed.data.apiKey,
      defaultLocale: parsed.data.defaultLocale,
    });
    await logAudit({
      tenantId: auth.ctx.tenantId,
      actorType: "user",
      actorId: auth.ctx.userId,
      action: "mail.ai_config_updated",
      metadata: {
        provider: parsed.data.provider,
        model: parsed.data.model,
        apiKeyRotated: parsed.data.apiKey !== undefined,
      },
    });
    return NextResponse.json(cfg);
  } catch (err) {
    console.error("[mail/ai-config PUT] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`ai-config:${auth.ctx.userId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  try {
    await deleteAiConfig(auth.ctx.tenantId);
    await logAudit({
      tenantId: auth.ctx.tenantId,
      actorType: "user",
      actorId: auth.ctx.userId,
      action: "mail.ai_config_deleted",
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[mail/ai-config DELETE] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
