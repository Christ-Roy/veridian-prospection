/**
 * Queries DB pour les templates mail customisables par tenant
 * (migration 0029, ticket follow-ups §A).
 *
 * Couche pour résoudre un template à l'usage :
 *  - lit d'abord la table tenant_mail_templates(tenant_id, slug)
 *  - fallback sur les MAIL_TEMPLATES hardcodés si pas trouvé
 *
 * Le fallback permet de garder le comportement v1 pour les tenants qui
 * n'ont jamais touché aux templates — pas de migration de données
 * destructive, juste une couche d'overrides.
 */
import { prisma } from "@/lib/prisma";
import {
  MAIL_TEMPLATES,
  type MailTemplate,
  listTemplates as listFallbackTemplates,
} from "@/lib/mail/templates";

export interface TenantMailTemplateRow {
  id: string;
  slug: string;
  label: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantTemplateInput {
  slug: string;
  label: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  variables?: string[];
}

/**
 * Liste les templates dispo pour ce tenant — concaténation des templates
 * tenant_mail_templates non soft-deleted ET des fallbacks hardcodés
 * (uniquement ceux dont le slug n'est PAS overridé par le tenant).
 *
 * Tri : tenant d'abord (alphabétique), puis fallbacks. UI affiche tout.
 */
export async function listTenantTemplates(
  tenantId: string,
): Promise<Array<{ slug: string; label: string; isCustom: boolean }>> {
  const customs = await prisma.tenantMailTemplate.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { label: "asc" },
    select: { slug: true, label: true },
  });

  const customSlugs = new Set(customs.map((c) => c.slug));
  const fallbacks = listFallbackTemplates()
    .filter((f) => !customSlugs.has(f.slug))
    .map((f) => ({ ...f, isCustom: false }));

  return [
    ...customs.map((c) => ({ ...c, isCustom: true })),
    ...fallbacks,
  ];
}

/**
 * Liste détaillée pour l'UI admin (page /settings/mail/templates).
 * Ne retourne QUE les customs (les fallbacks sont gérés par le code).
 */
export async function listCustomTemplates(
  tenantId: string,
): Promise<TenantMailTemplateRow[]> {
  const rows = await prisma.tenantMailTemplate.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    subject: r.subject,
    bodyText: r.bodyText,
    bodyHtml: r.bodyHtml,
    variables: Array.isArray(r.variables) ? (r.variables as string[]) : [],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Résout un template par slug pour le tenant. D'abord regarde la custom,
 * sinon retombe sur le fallback hardcodé. Retourne null si rien trouvé.
 *
 * Utilisé par /api/mail/send et /api/mail/render-preview.
 */
export async function resolveTemplate(
  tenantId: string,
  slug: string,
): Promise<MailTemplate | null> {
  const custom = await prisma.tenantMailTemplate.findFirst({
    where: { tenantId, slug, deletedAt: null },
    select: { slug: true, label: true, subject: true, bodyText: true, bodyHtml: true },
  });
  if (custom) return custom;

  return MAIL_TEMPLATES[slug] ?? null;
}

/**
 * Crée un template pour le tenant. Slug doit être unique parmi les
 * non-supprimés. Throw une erreur typée si conflit (le caller mappe en 409).
 */
export async function createTenantTemplate(
  tenantId: string,
  input: TenantTemplateInput,
): Promise<TenantMailTemplateRow> {
  // Vérifie le conflit avant l'INSERT pour un message d'erreur propre
  // (l'index UNIQUE partial fait également garde-fou côté DB).
  const existing = await prisma.tenantMailTemplate.findFirst({
    where: { tenantId, slug: input.slug, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new TenantTemplateConflictError(input.slug);
  }

  const row = await prisma.tenantMailTemplate.create({
    data: {
      tenantId,
      slug: input.slug,
      label: input.label,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      variables: input.variables ?? [],
    },
  });
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    subject: row.subject,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    variables: Array.isArray(row.variables) ? (row.variables as string[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Met à jour un template existant (par id). Vérifie l'appartenance tenant. */
export async function updateTenantTemplate(
  tenantId: string,
  templateId: string,
  input: Partial<TenantTemplateInput>,
): Promise<TenantMailTemplateRow | null> {
  const owned = await prisma.tenantMailTemplate.findFirst({
    where: { id: templateId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) return null;

  const row = await prisma.tenantMailTemplate.update({
    where: { id: templateId },
    data: {
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.bodyText !== undefined ? { bodyText: input.bodyText } : {}),
      ...(input.bodyHtml !== undefined ? { bodyHtml: input.bodyHtml } : {}),
      ...(input.variables !== undefined ? { variables: input.variables } : {}),
    },
  });
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    subject: row.subject,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    variables: Array.isArray(row.variables) ? (row.variables as string[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Soft delete un template. Idempotent : retourne false si déjà supprimé. */
export async function softDeleteTenantTemplate(
  tenantId: string,
  templateId: string,
): Promise<boolean> {
  const owned = await prisma.tenantMailTemplate.findFirst({
    where: { id: templateId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) return false;

  await prisma.tenantMailTemplate.update({
    where: { id: templateId },
    data: { deletedAt: new Date() },
  });
  return true;
}

export class TenantTemplateConflictError extends Error {
  constructor(public readonly slug: string) {
    super(`Template slug already exists for this tenant: ${slug}`);
    this.name = "TenantTemplateConflictError";
  }
}
