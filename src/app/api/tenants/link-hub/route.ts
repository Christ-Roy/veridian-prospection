/**
 * POST /api/tenants/link-hub — relie le tenant d'un propriétaire à son tenant Hub, et rien d'autre.
 *
 * Appelée par le Hub (`hub prospection-relier`) pour les tenants existants, à la place d'un rejeu du
 * provisionnement qui remettrait le rôle du propriétaire à admin et recréerait l'espace `default`.
 * Ni workspace, ni membre, ni jeton de connexion, ni clé d'API ne sont touchés.
 *
 * Auth : HMAC Hub §6.1 (`X-Veridian-Timestamp`, `X-Veridian-Hub-Signature` sur `{ts}.{body}`).
 * Corps : `{ hub_user_id, hub_tenant_id }` (uuid).
 * Réponses : 200 `{ linked, raison, tenant_id }` · 404 `user_unknown` · 400 · 401 · 429.
 */
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { verifyHubHmac } from "@/lib/hub/hmac";
import { lierTenantHub, UUID_RE } from "@/lib/hub/link-tenant";
import { isRateLimited } from "@/lib/rate-limit";

// Le Hub relie tous les tenants d'une traite : plus large que provision (10/min), toujours borné.
const DEBIT_MAX = 300;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(`link-hub:${ip}`, DEBIT_MAX, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const secret = process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
  if (!secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const rawBody = await request.text();
  const sig = request.headers.get("x-veridian-hub-signature");
  if (!sig) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const v = verifyHubHmac(secret, Number(request.headers.get("x-veridian-timestamp")), rawBody, sig);
  if (!v.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { hub_user_id?: unknown; hub_tenant_id?: unknown };
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const hubUserId = typeof body.hub_user_id === "string" ? body.hub_user_id.toLowerCase() : "";
  const hubTenantId = typeof body.hub_tenant_id === "string" ? body.hub_tenant_id.toLowerCase() : "";
  if (!UUID_RE.test(hubUserId) || !UUID_RE.test(hubTenantId)) {
    return NextResponse.json({ error: "hub_user_id et hub_tenant_id (uuid) requis" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({ where: { hubUserId, deletedAt: null }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "user_unknown" }, { status: 404 });

  // Le tenant dont il est propriétaire ; le plus ancien s'il y en a plusieurs (déterministe).
  const tenant = await prisma.tenant.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, hubTenantId: true },
  });
  if (!tenant) return NextResponse.json({ linked: false, raison: "aucun_tenant", tenant_id: null });

  const r = await lierTenantHub(tenant, hubTenantId);
  console.info(`[link-hub] hub_user=${hubUserId} tenant=${tenant.id} hub_tenant=${hubTenantId} linked=${r.linked} raison=${r.raison}`);
  return NextResponse.json({ ...r, tenant_id: tenant.id });
}
