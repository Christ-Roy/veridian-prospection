/**
 * GET /api/hub/users — comptes humains de l'app (CONTRAT-HUB §3.8).
 *
 * Auth : HMAC §6.1, signature sur `${ts}.` (corps vide). Sert à `hub reconcile`.
 * Un compte sans lien sort avec `hub_user_id: null` : c'est l'écart à mesurer.
 * Les clés API machine vivent sur les workspaces et ne sont pas dans `users`.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = await requireHubHmac(request);
  if (!auth.ok) return auth.response;

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { hubUserId: true, email: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      hub_user_id: u.hubUserId,
      email: u.email,
      name: u.name,
    })),
  });
}
