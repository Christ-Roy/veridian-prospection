/**
 * Ouvrir l'espace d'un client (VER-263) : compte, espace, atelier, appartenance, plan et lien au Hub, d'un seul tenant. Tout est écrit ou
 * rien ; rejouer ne crée ni ne change rien ; deux appels en même temps n'en créent qu'un. Ce qui est rendu est RELU après l'écriture.
 *
 * Remplace un chemin « au mieux » qui avalait ses erreurs et répondait 200 `created: true` sans avoir rien créé, ignorait le plan, et
 * réutilisait l'espace supprimé d'un ancien client (25/11).
 */
import type { Prisma } from "@prisma/client";

import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";
import { isCanonicalPlan, mapCanonicalPlanToLocal } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";

import { generateApiKey, hashApiKey } from "./apiKey";
import { resolveOrCreateUserFromHub } from "./identity";

export class RefusOuverture extends Error {
  constructor(readonly code: string, readonly statut: number, readonly detail: Record<string, unknown> = {}) {
    super(code);
  }
}

export type Ouverture = {
  user_id: string;
  tenant_id: string;
  hub_tenant_id: string | null;
  workspace_id: string;
  role: string;
  plan: string;
  status: string;
  name: string;
  /** Ce que CET appel a créé. */
  cree: { compte: boolean; espace: boolean; atelier: boolean; membre: boolean; lien: boolean };
  /** Seulement quand elle vient d'être tirée. */
  apiKey: string | null;
};

/** Nom du plan local, ou null s'il n'existe pas : un plan inconnu ne devient jamais « gratuit » en silence. */
export function planLocal(plan: string | undefined): string | null {
  if (plan === undefined || plan === "" || plan === "freemium") return "freemium";
  return isCanonicalPlan(plan) ? mapCanonicalPlanToLocal(plan).localPlan : null;
}

const slugDe = (email: string) => email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "espace";

export async function ouvrirEspace(e: { hubUserId: string; email: string; emailProven: boolean; hubTenantId: string | null; plan?: string; nom?: string | null }): Promise<Ouverture> {
  const email = e.email.trim().toLowerCase();
  const plan = planLocal(e.plan);
  if (!plan) throw new RefusOuverture("invalid_plan", 400, { plan: e.plan });

  const r = await prisma.$transaction(
    async (tx) => {
      // Un seul à la fois par personne, et par organisation : deux ouvertures simultanées n'en font qu'une.
      for (const cle of [`ouvrir:${e.hubUserId}`, ...(e.hubTenantId ? [`ouvrir:${e.hubTenantId}`] : [])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cle}, 0))`;
      const u = await resolveOrCreateUserFromHub({ hubUserId: e.hubUserId, email, emailProven: e.emailProven }, tx);
      if (u.hubUserIdConflict || u.emailUnproven) throw new RefusOuverture("email_not_linkable", 409);
      const compte = await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: { deletedAt: true } });
      if (compte.deletedAt) throw new RefusOuverture("user_deleted", 409);

      const { tenant, espace, lien } = await espaceDe(tx, u.id, e, plan, email);
      let atelier = false;
      const w =
        (await tx.workspace.findFirst({ where: { tenantId: tenant.id, slug: "default", deletedAt: null }, select: { id: true, apiKeyHash: true } })) ??
        ((atelier = true), await tx.workspace.create({ data: { tenantId: tenant.id, name: "Default", slug: "default", createdBy: u.id }, select: { id: true, apiKeyHash: true } }));
      // Rejouer ne change pas le rôle de quelqu'un qui est là.
      const fiche = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: w.id, userId: u.id } }, select: { deletedAt: true } });
      const membre = !fiche || !!fiche.deletedAt;
      if (membre) await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: w.id, userId: u.id } }, update: { deletedAt: null, role: "admin" }, create: { workspaceId: w.id, userId: u.id, role: "admin", visibilityScope: "all" } });
      let apiKey: string | null = null;
      if (!w.apiKeyHash) {
        apiKey = generateApiKey();
        await tx.workspace.update({ where: { id: w.id }, data: { apiKeyHash: hashApiKey(apiKey), apiKeyCreatedAt: new Date() } });
      }
      return { userId: u.id, tenantId: tenant.id, workspaceId: w.id, apiKey, cree: { compte: u.createdByHub, espace, atelier, membre, lien } };
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
  invalidateAllUserContexts();

  // Relu hors de la transaction : ce que la base montre à tout le monde, pas ce qu'on croit avoir écrit.
  const [t, m] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: r.tenantId, userId: r.userId, deletedAt: null }, select: { id: true, hubTenantId: true, plan: true, status: true, name: true } }),
    prisma.workspaceMember.findFirst({ where: { userId: r.userId, workspaceId: r.workspaceId, deletedAt: null, workspace: { tenantId: r.tenantId, deletedAt: null } }, select: { role: true } }),
  ]);
  if (!t || !m || (e.hubTenantId && t.hubTenantId !== e.hubTenantId)) throw new RefusOuverture("not_verified", 500);
  return { user_id: r.userId, tenant_id: t.id, hub_tenant_id: t.hubTenantId, workspace_id: r.workspaceId, role: m.role, plan: t.plan ?? "freemium", status: t.status, name: t.name, cree: r.cree, apiKey: r.apiKey };
}

async function espaceDe(tx: Prisma.TransactionClient, userId: string, e: { hubTenantId: string | null; nom?: string | null }, plan: string, email: string) {
  const champs = { id: true, userId: true, hubTenantId: true, status: true, deletedAt: true } as const;
  const parLien = e.hubTenantId ? await tx.tenant.findUnique({ where: { hubTenantId: e.hubTenantId }, select: champs }) : null;
  if (parLien && parLien.userId !== userId) throw new RefusOuverture("tenant_owned_by_other", 409, { tenant_id: parLien.id });
  // Supprimé mais gardé : il se restaure par sa route, jamais par une ouverture.
  if (parLien?.deletedAt) throw new RefusOuverture("tenant_soft_deleted", 409, { tenant_id: parLien.id });
  const vivant = parLien ?? (await tx.tenant.findFirst({ where: { userId, deletedAt: null }, select: champs, orderBy: { createdAt: "asc" } }));
  if (vivant) {
    if (vivant.status === "suspended") throw new RefusOuverture("tenant_suspended", 409, { tenant_id: vivant.id });
    const lien = !!e.hubTenantId && !vivant.hubTenantId;
    // Un propriétaire, un espace : une seconde organisation ne vole pas l'espace de la première, et ne passe pas pour ouverte.
    if (e.hubTenantId && vivant.hubTenantId && vivant.hubTenantId !== e.hubTenantId) throw new RefusOuverture("tenant_link_conflict", 409, { tenant_id: vivant.id, hub_tenant_id: vivant.hubTenantId });
    if (lien || vivant.status !== "active") await tx.tenant.update({ where: { id: vivant.id }, data: { ...(lien ? { hubTenantId: e.hubTenantId } : {}), status: "active" } });
    return { tenant: vivant, espace: false, lien };
  }
  const nom = e.nom?.trim().slice(0, 120) || email.split("@")[0];
  const tenant = await tx.tenant.create({ data: { userId, name: nom, slug: `${slugDe(email)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, status: "active", plan, hubTenantId: e.hubTenantId }, select: champs });
  return { tenant, espace: true, lien: !!e.hubTenantId };
}
