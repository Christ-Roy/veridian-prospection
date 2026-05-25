/**
 * GET /api/integrations/openrouter/status
 *
 * Renvoie l'état du link OpenRouter du user actuel (UI Settings).
 *   { connected: boolean, openrouterEmail: string|null, connectedAt: iso|null,
 *     lastUsedAt: iso|null, veridianFallbackAvailable: boolean }
 *
 * `veridianFallbackAvailable` = true si OPENROUTER_VERIDIAN_KEY env est posée
 * → la UI peut afficher "Génération offerte par Veridian" même non-connecté.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { getOpenRouterLinkPublic } from "@/lib/openrouter/queries";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const link = await getOpenRouterLinkPublic(auth.user.id);
  const veridianFallbackAvailable =
    typeof process.env.OPENROUTER_VERIDIAN_KEY === "string" &&
    process.env.OPENROUTER_VERIDIAN_KEY.length > 0;

  return NextResponse.json({
    ...link,
    veridianFallbackAvailable,
  });
}
