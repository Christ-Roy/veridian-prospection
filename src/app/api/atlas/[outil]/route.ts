/**
 * POST /api/atlas/[outil] — les écrans Atlas appellent les mêmes outils que l'IA (src/atlas/outils-mcp.ts) :
 * même validation, mêmes droits (un lecteur n'écrit pas), même espace (celui de la session, jamais un
 * argument). L'interface et l'agent ne peuvent pas diverger.
 */
import { NextRequest, NextResponse } from "next/server";

import { getUserContext, resolveInsertWorkspaceId } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { ErreurOutil } from "@/lib/mcp/erreur";
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ outil: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRateLimited(`atlas:${ctx.userId}`, 240, 60_000)) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });

  const { outil: nom } = await params;
  const c = { ctx, workspaceId: await resolveInsertWorkspaceId(ctx), client: null };
  const outil = OUTILS_ATLAS.find((o) => o.name === nom && (!o.visible || o.visible(c)));
  if (!outil) return NextResponse.json({ error: "outil inconnu ou non permis" }, { status: 404 });

  const corps = await request.json().catch(() => ({}));
  const args = outil.input.safeParse(corps);
  if (!args.success) {
    return NextResponse.json({ error: args.error.issues.map((i) => `${i.path.join(".") || "arguments"} : ${i.message}`).join(" ; ") }, { status: 400 });
  }
  try {
    return NextResponse.json(await outil.run(args.data as Record<string, unknown>, c), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErreurOutil) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(`[atlas] ${nom} :`, e);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
