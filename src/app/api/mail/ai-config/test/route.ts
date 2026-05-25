/**
 * /api/mail/ai-config/test — POST.
 *
 * Envoie un prompt minimal ("Dis bonjour en une phrase") à la config IA
 * du tenant. Sert à valider depuis l'UI Settings que la clé fonctionne
 * AVANT d'aller cliquer "✨ Rédige avec IA" sur une fiche prospect.
 *
 * Admin only — pas la peine d'exposer un test arbitraire à tous les users.
 * Rate limit : 10 / min par user (chaque test = 1 call provider payant).
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { recordAiUsage } from "@/lib/ai/queries";
import { resolveAdapter } from "@/lib/ai/resolver";
import { recordOpenRouterLinkUsage } from "@/lib/openrouter/queries";
import { AiAdapterError } from "@/lib/ai/adapter";

export async function POST() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`ai-config-test:${auth.ctx.userId}`, 10, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const resolved = await resolveAdapter({
    userId: auth.ctx.userId,
    tenantId: auth.ctx.tenantId,
  });
  if (!resolved) {
    return NextResponse.json(
      { ok: false, reason: "not_configured", error: "AI config not set up — fill in provider, model and API key first, or contact Veridian to enable the free tier" },
      { status: 412 },
    );
  }

  try {
    const result = await resolved.adapter.generateText("Réponds en une seule phrase : dis bonjour.", {
      maxTokens: 100,
      temperature: 0.3,
    });
    // Compte les tokens même pour le test — c'est de la consommation réelle.
    if (resolved.mode === "tenant-byo") {
      void recordAiUsage(auth.ctx.tenantId, result.tokensIn, result.tokensOut);
    } else if (resolved.mode === "user-byo") {
      void recordOpenRouterLinkUsage(auth.ctx.userId);
    }
    return NextResponse.json({
      ok: true,
      mode: resolved.mode,
      provider: resolved.provider,
      model: resolved.model,
      message: result.text.trim().slice(0, 300),
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    });
  } catch (err) {
    if (err instanceof AiAdapterError) {
      const status = err.kind === "auth" ? 401 : err.kind === "rate" ? 429 : err.kind === "server" ? 502 : 400;
      return NextResponse.json(
        {
          ok: false,
          reason: err.kind,
          error: err.message,
          providerStatus: err.statusFromProvider,
        },
        { status },
      );
    }
    console.error("[mail/ai-config/test] unexpected error:", err);
    return NextResponse.json(
      { ok: false, reason: "unknown", error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
