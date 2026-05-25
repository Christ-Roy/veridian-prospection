/**
 * Helper de seed / cleanup pour la config mail du tenant E2E canonique.
 *
 * Les specs utilisent le tenant `E2E_TENANT_ID` (cf e2e/helpers/auth.ts).
 * Pour les flows qui supposent SMTP déjà configuré (mail-send, rate-limit,
 * template-rendering), on pré-seed la row `tenant_mail_config` avec un
 * password chiffré côté serveur (encryptPassword utilise AUTH_SECRET, donc
 * la valeur DOIT être seedée par le même AUTH_SECRET que l'app — sinon
 * decrypt KO en runtime).
 *
 * NB : on passe par l'API PUT /api/mail/config (vs INSERT Prisma direct)
 * pour rester strictement en phase avec le chiffrement de l'app. Une
 * row insérée à la main avec un AUTH_SECRET local ne se déchiffre pas
 * côté staging.
 */
import { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";

const E2E_TENANT_ID = "e2e0e2e0-0000-4000-8000-000000000002";

let prismaSingleton: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

export interface SmtpConfigInput {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  fromEmail: string;
  fromName?: string | null;
}

export const MAILPIT_SMTP: SmtpConfigInput = {
  host: process.env.MAILPIT_SMTP_HOST || "mailpit-staging",
  port: Number(process.env.MAILPIT_SMTP_PORT || 1025),
  username: "any-user@mailpit.local",
  password: "any-password",
  tls: false, // mailpit accepte SMTP en clair sur 1025
  fromEmail: "e2e@veridian-prospection.test",
  fromName: "E2E Persistent",
};

/**
 * Seed la config mail du tenant E2E via l'API PUT /api/mail/config.
 *
 * Requiert un login préalable. On passe par `page.request` (et non
 * l'`APIRequestContext` du fixture) parce que `page.request` hérite des
 * cookies du `BrowserContext` (notamment `authjs.session-token` posé par
 * `loginAsE2EUser`). L'`APIRequestContext` du fixture est un context
 * isolé sans cookies.
 *
 * On passe le password en plain texte : c'est l'app qui le chiffrera avec
 * son AUTH_SECRET (garantit la cohérence du déchiffrement au moment du
 * send).
 *
 * Idempotent : upsert côté DB, peut être appelé en début de chaque spec.
 */
export async function seedMailConfig(
  page: Page,
  baseUrl: string,
  cfg: SmtpConfigInput = MAILPIT_SMTP,
): Promise<void> {
  const res = await page.request.put(`${baseUrl}/api/mail/config`, {
    data: {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      tls: cfg.tls,
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName ?? null,
    },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `[mail-config] PUT /api/mail/config a échoué (${res.status()}): ${body}`,
    );
  }
}

// `APIRequestContext` n'est plus utilisé par seedMailConfig — gardé en
// import pour les helpers futurs et pour rester en phase avec l'écosystème
// Playwright (autres helpers peuvent l'attendre).
export type { APIRequestContext };

/** Supprime la config mail du tenant E2E (pour spec mail-config-flow qui valide le PUT initial). */
export async function clearMailConfig(): Promise<void> {
  const prisma = getPrisma();
  await prisma.tenantMailConfig
    .deleteMany({ where: { tenantId: E2E_TENANT_ID } })
    .catch(() => {});
}

/** Récupère la config mail du tenant E2E directement en DB (vue interne). */
export async function readMailConfig(): Promise<{
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpPasswordEnc: string | null;
  smtpTls: boolean;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
} | null> {
  const prisma = getPrisma();
  const row = await prisma.tenantMailConfig.findUnique({
    where: { tenantId: E2E_TENANT_ID },
  });
  return row;
}

/** Compte les rows lead_emails pour le tenant E2E (sentStatus optionnel). */
export async function countLeadEmails(opts: {
  sentStatus?: "sent" | "failed";
  since?: Date;
} = {}): Promise<number> {
  const prisma = getPrisma();
  return prisma.leadEmail.count({
    where: {
      tenantId: E2E_TENANT_ID,
      sentStatus: opts.sentStatus,
      createdAt: opts.since ? { gte: opts.since } : undefined,
    },
  });
}

/** Récupère le dernier lead_email envoyé par le tenant E2E. */
export async function lastLeadEmail(): Promise<{
  id: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentStatus: string;
  templateSlug: string | null;
  messageId: string | null;
  sentError: string | null;
  toEmails: string[];
} | null> {
  const prisma = getPrisma();
  const row = await prisma.leadEmail.findFirst({
    where: { tenantId: E2E_TENANT_ID },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      subject: true,
      bodyText: true,
      bodyHtml: true,
      sentStatus: true,
      templateSlug: true,
      messageId: true,
      sentError: true,
      toEmails: true,
    },
  });
  return row;
}

/** Supprime tous les lead_emails du tenant E2E (cleanup entre specs). */
export async function purgeLeadEmails(): Promise<void> {
  const prisma = getPrisma();
  await prisma.leadEmail.deleteMany({ where: { tenantId: E2E_TENANT_ID } });
}
