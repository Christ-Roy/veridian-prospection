/**
 * POST /api/veridian/actions/{action} — une autre app Veridian agit pour un utilisateur (src/atlas/actions.ts).
 * Le jeton d'action du Hub est la seule authentification : ni session, ni clé. L'espace vient du jeton, jamais du corps.
 */
import { NextRequest, NextResponse } from "next/server";

import { ACTIONS, enRefus, RefusAction } from "@/atlas/actions";
import { verifierJetonAction } from "@/lib/actions/jeton-action";
import { espaceHub } from "@/lib/auth/espaces";
import { isUserFrozen } from "@/lib/auth/freeze";
import { buildUserContext } from "@/lib/auth/user-context";
import { consommer, tropDeRequetes } from "@/lib/compteurs";
import { JetonRefuse } from "@/lib/mcp/jeton-hub";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CORPS_MAX = 16 * 1024;

async function traiter(request: NextRequest, nom: string) {
  const brut = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!brut) throw new RefusAction("jeton_refuse", 401, "jeton d'action absent");
  const j = await verifierJetonAction(brut).catch((e) => {
    throw e instanceof JetonRefuse ? new RefusAction("jeton_refuse", 401, e.message) : e;
  });
  // Un seul usage, même si la demande est refusée ensuite. Base injoignable : 503, jamais d'exécution.
  if (!(await consommer(`jti:${j.jti}`, new Date(j.exp * 1000), 1, 1)).accepte) throw new RefusAction("jeton_deja_vu", 401);

  const action = Object.hasOwn(ACTIONS, nom) ? ACTIONS[nom] : null;
  if (!action) throw new RefusAction("action_inconnue", 404);
  if (!action.apps.includes(j.app)) throw new RefusAction("app_non_autorisee", 403);
  if (!j.portees.includes(action.portee)) throw new RefusAction("portee_insuffisante", 403);

  const user = await prisma.user.findFirst({ where: { hubUserId: j.hubUserId, deletedAt: null }, select: { id: true, email: true } });
  if (!user) throw new RefusAction("utilisateur_inconnu", 403);
  const e = await espaceHub(user.id, j.tenantId);
  if (e === "tenant_not_linked") throw new RefusAction("espace_non_relie", 409);
  if (e === "tenant_forbidden") throw new RefusAction("non_membre", 403);
  if (e === "tenant_suspended") throw new RefusAction("espace_suspendu", 403);
  const tenant = await prisma.tenant.findUnique({ where: { id: e.id }, select: { plan: true, status: true } });
  if (tenant?.status === "suspended" || (await isUserFrozen(user.id, e.id))) throw new RefusAction("espace_suspendu", 403);
  const ctx = await buildUserContext(user, null, e.id);
  if (!ctx || ctx.tenantId !== e.id) throw new RefusAction("non_membre", 403);
  if (await tropDeRequetes(`action:${user.id}`, 60, 60_000)) throw new RefusAction("trop_de_demandes", 429, undefined, 60);

  const cle = request.headers.get("idempotency-key");
  if (action.cle && !/^[\x21-\x7e]{8,128}$/.test(cle ?? "")) throw new RefusAction("cle_requise", 400);
  const texte = await request.text();
  if (texte.length > CORPS_MAX) throw new RefusAction("corps_trop_grand", 413);
  let corps: unknown;
  try {
    corps = JSON.parse(texte || "{}");
  } catch {
    throw new RefusAction("demande_invalide", 400, "JSON illisible");
  }
  const lu = action.entree.safeParse(corps);
  if (!lu.success) throw new RefusAction("demande_invalide", 400, lu.error.issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ; "));

  const { rejoue = false, ...resultat } = await action.run(lu.data as never, { ctx, app: j.app, plan: tenant?.plan ?? null, cle });
  console.info(`[actions] action=${nom} app=${j.app} user=${user.id} rejoue=${rejoue}`);
  return { action: nom, rejoue, resultat };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  try {
    return NextResponse.json(await traiter(request, action), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const r = enRefus(e);
    console.warn(`[actions] refus action=${action.slice(0, 40)} code=${r.code}`);
    return NextResponse.json({ error: r.code, ...(r.detail ? { detail: r.detail } : {}) }, { status: r.statut, headers: { "Cache-Control": "no-store", ...(r.attendre ? { "Retry-After": String(r.attendre) } : {}) } });
  }
}
