/**
 * POST /api/hub/users/sync — le Hub pousse une modification (CONTRAT-HUB §3.8).
 *
 * Auth : HMAC §6.1. Corps : { hub_user_id, name?, email?, deleted?, revoke_sessions? }.
 * Le compte se retrouve par `hub_user_id` UNIQUEMENT, jamais par email : une
 * adresse ne doit pas pouvoir désigner le compte d'un autre. Seuls les champs
 * présents s'appliquent. `deleted: true` coupe les sessions et l'accès.
 * `revoke_sessions: true` coupe toutes les sessions sans toucher au compte.
 *
 * Réponses :
 *   200 { updated: true|false }  idempotent : false si rien ne change
 *   400 { error: "invalid_payload" }
 *   401 HMAC invalide
 *   404 { error: "user_not_in_app" }
 *   409 { error: "email_conflict" }  (adresse déjà portée par un autre compte local)
 */
import { NextRequest, NextResponse } from "next/server";
import { invalidateActiveUser } from "@/lib/auth/active-user";
import { invalidateUserContext } from "@/lib/auth/user-context";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 200;

type SyncBody = {
  hub_user_id?: unknown;
  name?: unknown;
  email?: unknown;
  deleted?: unknown;
  revoke_sessions?: unknown;
};

function invalid() {
  return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<SyncBody>(request);
  if (!auth.ok) return auth.response;
  const { hub_user_id: hubUserId, name, email, deleted, revoke_sessions: revoke } = auth.body;

  if (typeof hubUserId !== "string" || !hubUserId) return invalid();
  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > NAME_MAX)) {
    return invalid();
  }
  if (
    email !== undefined &&
    (typeof email !== "string" || email.length > 254 || !EMAIL_RE.test(email.trim()))
  ) {
    return invalid();
  }
  if (deleted !== undefined && typeof deleted !== "boolean") return invalid();
  if (revoke !== undefined && typeof revoke !== "boolean") return invalid();

  // La colonne est un UUID : un autre format ferait lever Prisma (P2023) et ne
  // peut désigner aucun compte.
  const user = UUID_RE.test(hubUserId)
    ? await prisma.user.findUnique({
        where: { hubUserId },
        select: { id: true, email: true, name: true, deletedAt: true },
      })
    : null;
  if (!user) {
    return NextResponse.json({ error: "user_not_in_app" }, { status: 404 });
  }

  const data: {
    name?: string | null;
    email?: string;
    deletedAt?: Date;
    sessionsValidAfter?: Date;
  } = {};
  if (name !== undefined && name !== user.name) data.name = name as string | null;
  if (email !== undefined) {
    const normalized = (email as string).trim().toLowerCase();
    if (normalized !== user.email) data.email = normalized;
  }
  if (deleted === true && !user.deletedAt) data.deletedAt = new Date();
  if (revoke === true) data.sessionsValidAfter = new Date();

  const updated = Object.keys(data).length > 0;
  if (updated) {
    try {
      await prisma.user.update({ where: { id: user.id }, data });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "email_conflict" }, { status: 409 });
      }
      throw err;
    }
  }

  if (deleted === true || revoke === true) {
    // Le JWT reste signé : c'est `applyActiveUser` qui le refuse désormais. On
    // retire aussi les liens en cours, qui en ouvriraient une nouvelle.
    await prisma.ssoLoginToken.deleteMany({ where: { userId: user.id } });
    await prisma.tenant.updateMany({
      where: { userId: user.id, prospectionLoginToken: { not: null } },
      data: { prospectionLoginToken: null },
    });
  }
  invalidateActiveUser(user.id);
  invalidateUserContext(user.id);

  console.log(
    `[hub/users/sync] user=${user.id} fields=${Object.keys(data).join(",") || "none"}`,
  );

  return NextResponse.json({ updated });
}
