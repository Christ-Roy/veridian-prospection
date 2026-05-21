/**
 * GET /api/tenants/{id}/health — contrat §5.5
 *
 * Auth : HMAC Hub (pattern A §6.1). Le Hub appelle en cron 1×/h pour les
 * tenants actifs.
 *
 * Retourne l'état complet du tenant côté app pour décision pilotage côté Hub.
 *
 * `magic_link_capable: false` si :
 *  - tenant introuvable
 *  - pas d'owner humain attaché au workspace default
 *  - api_key révoquée (pas encore implémenté, prepared pour P3)
 *  - tenant soft_deleted (deletedAt != null)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // GET sans body — on simule le rawBody vide pour requireHubHmac
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const { id: tenantIdParam } = await params;
  if (!tenantIdParam) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant id is required" },
      { status: 400 },
    );
  }

  // Le Hub peut envoyer soit l'UUID local soit l'email owner — historiquement
  // `POST /api/tenants/provision` retourne `tenant_id: <owner_email>`.
  // Cf todo/2026-05-21-tenant-id-accept-email-or-uuid.md (Option B Robert).
  const resolved = await resolveTenantByIdOrEmail(tenantIdParam);
  if (!resolved) {
    return NextResponse.json(
      {
        tenant_id: tenantIdParam,
        workspace_id: null,
        status: "deleted",
        owner_attached: false,
        owner_email: null,
        owner_user_id: null,
        api_key_valid: false,
        magic_link_capable: false,
        members_count: 0,
        plan: null,
        checked_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  }
  // Toute la suite utilise l'UUID local résolu, JAMAIS `tenantIdParam`.
  const tenantId = resolved.id;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      metadata: true,
    },
  });
  if (!tenant) {
    // Race condition rarissime entre resolve et findUnique — même forme
    // "deleted" pour rester déterministe côté Hub.
    return NextResponse.json(
      {
        tenant_id: tenantId,
        workspace_id: null,
        status: "deleted",
        owner_attached: false,
        owner_email: null,
        owner_user_id: null,
        api_key_valid: false,
        magic_link_capable: false,
        members_count: 0,
        plan: null,
        checked_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  // Workspace default + owner détection (2 queries — pas de relation
  // WorkspaceMember→User côté schema, on hydrate manuellement)
  const workspace = await prisma.workspace.findFirst({
    where: { tenantId, slug: "default" },
    select: {
      id: true,
      members: {
        where: { deletedAt: null },
        orderBy: { joinedAt: "asc" },
        select: { userId: true, role: true },
      },
    },
  });

  const members = workspace?.members ?? [];
  const ownerMember =
    members.find((m) => m.role === "owner" || m.role === "admin") ??
    members[0] ??
    null;

  let ownerEmail: string | null = null;
  if (ownerMember) {
    const u = await prisma.user.findUnique({
      where: { id: ownerMember.userId },
      select: { email: true },
    });
    ownerEmail = u?.email ?? null;
  }
  const ownerAttached = Boolean(ownerMember);
  const status = tenant.deletedAt
    ? "deleted"
    : tenant.status === "suspended"
      ? "suspended"
      : "active";

  // Plan : source de vérité = colonne Prisma `plan` (model Tenant).
  // Backfill historique migration 0004 : plan ← COALESCE(plan, prospection_plan).
  // Fallback "freemium" si raw query échoue (DB de test sans la colonne).
  let plan: string | null = "freemium";
  try {
    const rows = await prisma.$queryRawUnsafe<{ plan: string | null }[]>(
      `SELECT plan FROM tenants WHERE id = $1::uuid LIMIT 1`,
      tenantId,
    );
    plan = rows[0]?.plan ?? "freemium";
  } catch {
    // colonne absente (test/local) → on garde "freemium"
  }

  const magicLinkCapable = ownerAttached && !tenant.deletedAt;

  return NextResponse.json({
    tenant_id: tenantId,
    workspace_id: workspace?.id ?? null,
    status,
    owner_attached: ownerAttached,
    owner_email: ownerEmail,
    owner_user_id: ownerMember?.userId ?? null,
    api_key_valid: true, // P3 — branchera la table api_keys
    magic_link_capable: magicLinkCapable,
    members_count: members.length,
    plan,
    checked_at: new Date().toISOString(),
  });
}
