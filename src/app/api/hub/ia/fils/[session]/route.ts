/**
 * GET / PUT /api/hub/ia/fils/:session (CONTRAT-HUB §5.24, VER-203) : le fil de « Mon IA » rangé dans Prospection.
 * Appelé par le Hub seul, serveur à serveur, signature §6.1.1 (v2 : usage unique). Un navigateur est refusé avant tout.
 * GET : 200 { messages } pour CE triplet, 404 sinon (fil d'un autre compris). PUT : remplace ou crée ; 409 fil_autre_auteur
 * si la session est rangée pour un autre triplet ; 413 au-delà de 1 Mo ou de 200 messages.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireHubHmac } from "@/lib/hub/auth";
import { estUuid, FIL_MESSAGES_MAX, FIL_OCTETS_MAX, membreHub } from "@/lib/hub/ia-fils";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ session: string }> };

const CorpsPut = z.object({
  hub_user_id: z.string().min(1).max(64),
  tenant_id: z.string().min(1).max(64),
  messages: z.array(z.record(z.string(), z.unknown())),
});

const refus = (status: number, error: string) => NextResponse.json({ error }, { status });
/**
 * Ces routes ne sont jamais appelées par un navigateur : un en-tête que SEUL un navigateur pose suffit à refuser.
 * Pas `sec-fetch-mode` : le fetch de Node (undici) le pose à chaque appel serveur (`cors`), il coupait le Hub (26/11).
 */
const parNavigateur = (r: NextRequest) => r.headers.has("sec-fetch-site") || r.headers.has("origin");
const inconnu = () => refus(404, "fil_inconnu");

export async function GET(request: NextRequest, { params }: Ctx) {
  if (parNavigateur(request)) return refus(401, "Unauthorized");
  const auth = await requireHubHmac(request);
  if (!auth.ok) return auth.response;
  const { session } = await params;
  const q = request.nextUrl.searchParams;
  const hubUserId = q.get("hub_user_id") ?? "", hubTenantId = q.get("tenant_id") ?? "";
  if (!estUuid(session) || !hubUserId || !hubTenantId) return refus(400, "invalid_payload");
  const m = await membreHub(hubTenantId, hubUserId);
  if (!m) return inconnu();
  const fil = await prisma.iaFil.findUnique({ where: { sessionId: session } });
  if (!fil || fil.tenantId !== m.tenantId || fil.userId !== m.userId) return inconnu();
  return NextResponse.json({ messages: fil.messages });
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  if (parNavigateur(request)) return refus(401, "Unauthorized");
  // Borne avant lecture : un corps démesuré ne passe pas en mémoire (la vraie mesure suit la signature).
  if (Number(request.headers.get("content-length") ?? 0) > 2 * FIL_OCTETS_MAX) return refus(413, "fil_trop_grand");
  const auth = await requireHubHmac(request);
  if (!auth.ok) return auth.response;
  const { session } = await params;
  if (!estUuid(session)) return refus(400, "invalid_payload");
  if (Buffer.byteLength(auth.rawBody, "utf8") > FIL_OCTETS_MAX) return refus(413, "fil_trop_grand");
  const p = CorpsPut.safeParse(auth.body);
  if (!p.success) return refus(400, "invalid_payload");
  if (p.data.messages.length > FIL_MESSAGES_MAX) return refus(413, "fil_trop_long");
  const m = await membreHub(p.data.tenant_id, p.data.hub_user_id);
  if (!m) return inconnu();
  const existant = await prisma.iaFil.findUnique({ where: { sessionId: session }, select: { tenantId: true, userId: true } });
  if (existant && (existant.tenantId !== m.tenantId || existant.userId !== m.userId)) return refus(409, "fil_autre_auteur");
  const messages = p.data.messages as Prisma.InputJsonValue;
  await prisma.iaFil.upsert({
    where: { sessionId: session },
    create: { sessionId: session, tenantId: m.tenantId, userId: m.userId, messages },
    update: { messages },
  });
  console.log(`[ia][fil] tenant=${m.tenantId} session=${session} messages=${p.data.messages.length}`);
  return NextResponse.json({});
}
