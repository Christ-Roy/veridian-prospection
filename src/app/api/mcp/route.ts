/**
 * POST /api/mcp — MCP de Prospection, appelé par la porte MCP du Hub (veridian-hub/docs/CONTRAT-MCP.md).
 *
 * Streamable HTTP sans état : réponses JSON, pas de session. Le Hub signe l'identité (JWT ES256,
 * `aud` = cette URL, `sub` = hub_user_id) ; l'utilisateur et son espace sont retrouvés ici, jamais
 * créés. Un utilisateur inconnu ou sans espace reçoit une erreur claire.
 */
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { buildUserContext, espaceHub, resolveInsertWorkspaceId } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { JetonRefuse, verifierJetonHub } from "@/lib/mcp/jeton-hub";
import { traiter, type Message, type Reponse } from "@/lib/mcp/protocole";

export const dynamic = "force-dynamic";

const CORPS_MAX = 256 * 1024;
const DEBIT_MAX = 120; // requêtes MCP par minute et par utilisateur

function refus(status: number, message: string, id: Message["id"] = null) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code: status === 429 ? -32000 : -32001, message } }, { status });
}

export async function POST(request: NextRequest) {
  const authz = request.headers.get("authorization") ?? "";
  const jeton = /^Bearer\s+(.+)$/i.exec(authz)?.[1]?.trim();
  if (!jeton) return refus(401, "jeton du Hub absent : passez par https://app.veridian.site/api/mcp");

  let identite;
  try {
    identite = await verifierJetonHub(jeton);
  } catch (e) {
    if (e instanceof JetonRefuse) return refus(401, `jeton du Hub refusé : ${e.message}`);
    throw e;
  }

  const user = await prisma.user.findFirst({
    where: { hubUserId: identite.hubUserId, deletedAt: null },
    select: { id: true, email: true },
  });
  // `hub_user_unknown` : le Hub crée alors le compte par son chemin habituel et réessaie (CONTRAT-MCP §2).
  if (!user) return refus(401, "hub_user_unknown : compte inconnu de Prospection, ouvrez Prospection une fois depuis le Hub");

  // Espace : sans claim, celui par défaut ; avec claim, ce tenant Hub relié et dont il est membre,
  // jamais de repli silencieux (CONTRAT-MCP §2).
  let espaceDemande: string | null = null;
  if (identite.tenantId) {
    const e = await espaceHub(user.id, identite.tenantId);
    if (e === "tenant_not_linked") return refus(403, "tenant_not_linked : cet espace Hub n'est relié à aucun espace Prospection");
    if (e === "tenant_forbidden") return refus(403, "tenant_forbidden : ce compte n'est pas membre de cet espace Prospection");
    espaceDemande = e.id;
  }
  const ctx = await buildUserContext(user, null, espaceDemande);
  if (!ctx) return refus(403, "aucun espace Prospection pour ce compte");
  if (espaceDemande && ctx.tenantId !== espaceDemande) {
    return refus(403, "tenant_forbidden : ce compte n'est pas membre de cet espace Prospection");
  }

  if (isRateLimited(`mcp:${user.id}`, DEBIT_MAX, 60_000)) return refus(429, "trop de requêtes MCP : réessayez dans une minute");

  const brut = await request.text();
  if (brut.length > CORPS_MAX) return refus(413, "requête trop volumineuse");
  let corps: unknown;
  try {
    corps = JSON.parse(brut);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible" } }, { status: 400 });
  }

  const contexte = { ctx, workspaceId: await resolveInsertWorkspaceId(ctx), client: identite.clientId ?? null };
  const journal = (e: { outil: string; issue: string; ms: number }) =>
    console.info(`[mcp] outil=${e.outil} issue=${e.issue} ms=${e.ms} user=${user.id} client=${identite.clientId ?? "?"}`);

  const messages = (Array.isArray(corps) ? corps : [corps]) as Message[];
  if (messages.length === 0 || messages.length > 20) return refus(400, "lot JSON-RPC vide ou trop long");
  const reponses = (await Promise.all(messages.map((m) => traiter(m, contexte, journal)))).filter(
    (r): r is Reponse => r !== null,
  );

  // Que des notifications : accusé de réception sans corps.
  if (reponses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(corps) ? reponses : reponses[0], {
    headers: { "Cache-Control": "no-store" },
  });
}

// Pas de flux serveur ni de session à fermer : seul POST est servi.
function nonServi() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export const GET = nonServi;
export const DELETE = nonServi;
