/**
 * POST /api/atlas/[outil] — les écrans Atlas appellent les mêmes outils que l'IA (src/atlas/outils-mcp.ts) :
 * même validation, mêmes droits (un lecteur n'écrit pas), même espace (celui de la session, jamais un
 * argument). L'interface et l'agent ne peuvent pas diverger.
 * Un script d'un espace à accès avancé s'y authentifie par clé API (`Authorization: Bearer atl_…`).
 */
import { NextRequest, NextResponse } from "next/server";

import { getUserContext, resolveInsertWorkspaceId } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { ErreurOutil } from "@/lib/mcp/erreur";
import { outilsVisibles } from "@/lib/mcp/outils";
import { contexteDepuisCle, droits } from "@/atlas/acces";
import { selonPlan } from "@/atlas/gratuit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ outil: string }> }) {
  const parCle = request.headers.get("authorization");
  const ctx = parCle ? await contexteDepuisCle(parCle) : await getUserContext();
  if (!ctx) return NextResponse.json({ error: parCle ? "Clé API invalide, révoquée, ou espace sans accès avancé" : "Unauthorized" }, { status: 401 });
  if (isRateLimited(`atlas:${ctx.userId}`, 240, 60_000)) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });

  const { outil: nom } = await params;
  const c = { ctx, workspaceId: await resolveInsertWorkspaceId(ctx), client: parCle ? "clé API" : null, droits: await droits(ctx.userId, ctx.tenantId) };
  const outil = outilsVisibles(c).find((o) => o.name === nom);
  if (!outil) return NextResponse.json({ error: "outil inconnu ou non permis" }, { status: 404 });

  const corps = await request.json().catch(() => ({}));
  const args = outil.input.safeParse(corps);
  if (!args.success) {
    return NextResponse.json({ error: args.error.issues.map((i) => `${i.path.join(".") || "arguments"} : ${i.message}`).join(" ; ") }, { status: 400 });
  }
  try {
    return NextResponse.json(await selonPlan(outil, args.data as Record<string, unknown>, c), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErreurOutil) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(`[atlas] ${nom} :`, e);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
