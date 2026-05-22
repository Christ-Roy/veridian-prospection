/**
 * Shared e2e auth helper — canonical persistent user (Auth.js v5).
 *
 * CONTEXTE — migration Supabase → Auth.js v5 (2026-05-22)
 * -------------------------------------------------------
 * Ce helper parlait à Supabase GoTrue (`/auth/v1/token`, `/auth/v1/admin/users`)
 * sur `saas-api.staging.veridian.site` — un service qui ne tourne plus. Pire :
 * il `test.skip()`-ait silencieusement si les clés `SUPABASE_*` manquaient, donc
 * 11 specs E2E se skippaient sans alerte rouge (couverture surévaluée).
 *
 * L'app est passée à Auth.js v5 + provider Credentials : validation contre les
 * tables Prisma `users` / `accounts` (hash bcrypt stocké dans
 * `accounts.access_token`). Ce helper a été réécrit pour ce flow :
 *
 *  1. Seed Prisma idempotent du compte canonique (User + Account credentials
 *     bcrypt + Tenant + Workspace "default" + WorkspaceMember admin/all).
 *     Reproduit exactement ce que fait `ensureOwnerWorkspace()` côté
 *     `/api/tenants/provision`, mais avec un password (provision ne crée pas
 *     d'Account credentials — il fait du magic-link only).
 *  2. Login via le vrai formulaire `/login` (et son `signIn("credentials")`
 *     client Auth.js). Playwright `locator.fill()` déclenche les events React
 *     natifs — contrairement au `form_input` du MCP Chrome qui ne les bubble
 *     pas (cf memory chrome-mcp-login-pattern). `signIn()` gère le couplage
 *     csrfToken/cookie nativement : pas de fetch CSRF manuel fragile.
 *
 * GARANTIES
 * ---------
 *  - Idempotent : 10 runs → exactement un user canonique, zéro pollution.
 *  - PLUS DE SKIP SILENCIEUX : si `DATABASE_URL` est absent / la DB est
 *    injoignable, le helper LÈVE une erreur explicite. Une spec qui ne peut
 *    pas s'authentifier doit échouer ROUGE, pas se skipper.
 *  - API inchangée : `await loginAsE2EUser(page, request)` — aucune spec
 *    appelante à modifier.
 *
 * PRÉ-REQUIS D'EXÉCUTION
 * ----------------------
 * Les specs Playwright qui importent ce helper tournent contre une URL
 * (`PROSPECTION_URL`) ET ont besoin d'un accès Prisma à LA MÊME base que
 * cette URL. Concrètement :
 *  - Local : `PROSPECTION_URL=http://localhost:3000` + `DATABASE_URL` pointant
 *    sur la DB locale de ce `next start`.
 *  - dev-pub (réseau staging-edge) : `PROSPECTION_URL` interne + `DATABASE_URL`
 *    interne `postgres-staging`.
 * Le seed et l'app DOIVENT taper la même DB, sinon le login échoue (user
 * seedé dans une base, validé contre une autre).
 *
 * USAGE
 * -----
 *   import { loginAsE2EUser } from "./helpers/auth";
 *   test("something", async ({ page, request }) => {
 *     await loginAsE2EUser(page, request);
 *     // page est authentifiée sur ${PROSPECTION_URL}/prospects
 *   });
 */
import { test, type APIRequestContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const E2E_USER_EMAIL = "e2e-persistent@yopmail.com";
export const E2E_USER_PASSWORD = "E2ePersistent2026!";
export const E2E_TENANT_NAME = "e2e-persistent";

/**
 * UUIDs fixes du compte canonique. Posés en dur (pas générés) pour que le
 * seed soit strictement idempotent entre runs et entre environnements, et
 * pour que les lignes soient identifiables en DB (`SELECT ... WHERE id = ...`).
 * User et Tenant ont des id distincts (deux tables, mais on évite la
 * confusion d'un UUID partagé).
 */
const E2E_USER_ID = "e2e0e2e0-0000-4000-8000-000000000001";
const E2E_TENANT_ID = "e2e0e2e0-0000-4000-8000-000000000002";
const E2E_TENANT_SLUG = "e2e-persistent-canonical";

function env(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

/**
 * Prisma client partagé entre specs (Playwright lance chaque spec dans son
 * worker ; le module est évalué une fois par worker → un client par worker,
 * fermé en fin de process par Node). On ne crée pas un client par appel.
 */
let prismaSingleton: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    if (!env("DATABASE_URL")) {
      throw new Error(
        "[e2e/auth] DATABASE_URL absent — impossible de seeder le compte " +
          "canonique. Le helper NE skippe PLUS en silence (cf migration " +
          "Auth.js v5). Exporte DATABASE_URL pointant sur la DB de l'app " +
          "ciblée par PROSPECTION_URL.",
      );
    }
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

/**
 * Crée (idempotent) le compte canonique complet en DB Prisma :
 *   User → Account(credentials, bcrypt) → Tenant → Workspace(default) →
 *   WorkspaceMember(admin, scope all).
 *
 * Reproduit la chaîne de `ensureOwnerWorkspace()` (route provision) en y
 * ajoutant l'Account credentials nécessaire au login email/password.
 *
 * Idempotent : tous les writes sont des upsert ou des create gardés par un
 * findFirst. Rejouer cette fonction 100× ne crée qu'un seul jeu de lignes.
 */
async function ensureCanonicalUser(): Promise<void> {
  const prisma = getPrisma();
  const passwordHash = await bcrypt.hash(E2E_USER_PASSWORD, 10);

  // 1) User — upsert par email (unique). On force l'id canonique à la
  //    création ; si le user existe déjà sous un autre id (legacy), on garde
  //    son id et on continue (le reste de la chaîne se résout par email/id).
  const user = await prisma.user.upsert({
    where: { email: E2E_USER_EMAIL },
    update: { name: "E2E Persistent", deletedAt: null },
    create: {
      id: E2E_USER_ID,
      email: E2E_USER_EMAIL,
      name: "E2E Persistent",
      emailVerified: new Date(),
    },
    select: { id: true },
  });

  // 2) Account credentials — le provider Credentials lit le hash bcrypt dans
  //    `access_token` d'un Account `provider="credentials"`. Clé unique
  //    Prisma : (provider, providerAccountId). On utilise l'email comme
  //    providerAccountId (stable, unique par user).
  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: "credentials",
        providerAccountId: E2E_USER_EMAIL,
      },
    },
    select: { id: true },
  });
  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { userId: user.id, access_token: passwordHash },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: user.id,
        type: "credentials",
        provider: "credentials",
        providerAccountId: E2E_USER_EMAIL,
        access_token: passwordHash,
      },
    });
  }

  // 3) Tenant — owner = user. On cherche un tenant vivant déjà détenu par ce
  //    user (même filtre `deletedAt: null` que getUserContext) ; sinon upsert
  //    sur le slug canonique (clé unique) en (re)posant l'ownership et en
  //    annulant un éventuel soft-delete.
  let tenant = await prisma.tenant.findFirst({
    where: { userId: user.id, deletedAt: null },
    select: { id: true },
  });
  if (!tenant) {
    tenant = await prisma.tenant.upsert({
      where: { slug: E2E_TENANT_SLUG },
      update: { userId: user.id, status: "active", deletedAt: null },
      create: {
        id: E2E_TENANT_ID,
        userId: user.id,
        name: E2E_TENANT_NAME,
        slug: E2E_TENANT_SLUG,
        status: "active",
      },
      select: { id: true },
    });
  }

  // 4) Workspace "default" rattaché au tenant.
  let workspace = await prisma.workspace.findFirst({
    where: { tenantId: tenant.id, slug: "default" },
    select: { id: true },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        tenantId: tenant.id,
        name: "Default",
        slug: "default",
        createdBy: user.id,
      },
      select: { id: true },
    });
  }

  // 5) WorkspaceMember — admin, visibilité "all" (voit tout le workspace).
  //    upsert sur la clé composite (workspaceId, userId).
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
    },
    update: { role: "admin", visibilityScope: "all", deletedAt: null },
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "admin",
      visibilityScope: "all",
    },
  });
}

/**
 * Ouvre une session Auth.js v5 en remplissant le vrai formulaire `/login`.
 *
 * On passe par le form réel (et son `signIn("credentials")` client) plutôt
 * que par un fetch CSRF + POST manuel. Raison : Auth.js v5 lie le `csrfToken`
 * du body au cookie `authjs.csrf-token`. Reconstruire ce couple à la main est
 * fragile (course cookie/fetch → `MissingCSRF` → callback 500). `signIn()` du
 * client Auth.js gère ce couplage nativement.
 *
 * NB : Playwright `locator.fill()` déclenche les events React natifs
 * (`input`/`change`), contrairement au `form_input` du MCP Chrome qui ne les
 * bubble pas — le form `/login` se soumet donc bien ici.
 *
 * Le cookie de session (`__Secure-authjs.session-token` en HTTPS prod,
 * `authjs.session-token` en HTTP local) est posé par Auth.js sur le
 * BrowserContext de la page.
 *
 * Lève si la session n'est pas établie — pas de skip.
 */
async function signInViaAuthJs(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);

  // Le champ email a un placeholder, le password non → getByLabel cible les
  // deux de façon stable (cf e2e/staging-full/critical-journeys.spec.ts).
  await page.getByLabel("Email", { exact: true }).fill(E2E_USER_EMAIL);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(E2E_USER_PASSWORD);
  await page.getByRole("button", { name: /se connecter/i }).click();

  // Le form redirige vers /prospects (ou /) en cas de succès, ou affiche une
  // erreur inline en restant sur /login. On attend la sortie de /login.
  await page
    .waitForURL(/\/(prospects|admin|$)/, { timeout: 25_000 })
    .catch(() => {});

  // Vérifie la session réellement établie (cookie reconnu), pas seulement
  // l'URL — une redirection peut survenir sans session valide.
  const session = await page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    return res.ok ? await res.json() : null;
  });

  if (!session || !session.user || !session.user.id) {
    throw new Error(
      `[e2e/auth] Login Auth.js échoué — pas de session après soumission du ` +
        `formulaire /login (url=${page.url()}). Vérifie que le compte ` +
        `canonique est seedé dans la MÊME DB que ${baseUrl}, et que ` +
        `AUTH_SECRET est posé côté app.`,
    );
  }
}

/**
 * Crée si besoin le compte canonique e2e et ouvre une session Auth.js v5 sur
 * le dashboard prospection.
 *
 * Étapes :
 *  1. Seed Prisma idempotent (User + Account + Tenant + Workspace + Member).
 *  2. Login Auth.js (CSRF + POST credentials) — cookie session posé.
 *  3. Navigation sur /prospects + attente du rendu.
 *  4. Suppression best-effort des modales onboarding / paywall.
 *
 * Le second paramètre `request` est conservé pour compat de signature avec
 * les ~11 specs appelantes (il n'est plus nécessaire au flow — le login passe
 * par le contexte `page`). Le garder évite de toucher chaque spec.
 *
 * Lève une erreur en cas d'échec (DB injoignable, login KO, redirect bloqué).
 * NE SKIPPE JAMAIS.
 */
export async function loginAsE2EUser(
  page: Page,
  _request: APIRequestContext,
): Promise<void> {
  const PROSPECTION_URL = env("PROSPECTION_URL", "http://localhost:3000");

  // Étape 1 : seed idempotent du compte canonique en DB.
  await ensureCanonicalUser();

  // Étape 2 : login Auth.js v5 (cookie session posé sur le BrowserContext).
  await signInViaAuthJs(page, PROSPECTION_URL);

  // Étape 3 : aller sur /prospects et confirmer qu'on n'est pas rejeté.
  await page.goto(`${PROSPECTION_URL}/prospects`);
  await page
    .waitForURL(/\/(prospects|$)/, { timeout: 20_000 })
    .catch(() => {});
  if (page.url().includes("/login")) {
    throw new Error(
      `[e2e/auth] Redirigé vers /login après authentification — session non ` +
        `reconnue par le middleware. URL: ${page.url()}`,
    );
  }

  // Étape 4 : best-effort — supprimer la modale onboarding si elle apparaît.
  await page
    .evaluate(async () => {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding_done: "true" }),
      }).catch(() => {});
    })
    .catch(() => {});

  const skipBtn = page.locator('[data-testid="onboarding-skip"]');
  if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipBtn.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // Étape 5 : best-effort — fermer la modale paywall si présente (X top-right).
  const paywallClose = page
    .locator("div.fixed.inset-0.z-50 button:has(svg.lucide-x)")
    .first();
  if (await paywallClose.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await paywallClose.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/**
 * Vérifie que le compte canonique peut s'authentifier via Auth.js v5.
 * Retourne `true` si la session est valide après login, `false` sinon.
 * Ne lève jamais — usage diagnostic (parité avec l'ancienne API).
 *
 * Note : le seed du compte n'est PAS fait ici (contrairement à
 * `loginAsE2EUser`). Appeler `loginAsE2EUser` au préalable si le compte peut
 * ne pas exister.
 */
export async function canSignIn(page: Page): Promise<boolean> {
  try {
    const PROSPECTION_URL = env("PROSPECTION_URL", "http://localhost:3000");
    await signInViaAuthJs(page, PROSPECTION_URL);
    return true;
  } catch {
    return false;
  }
}

// `test` est importé pour rester cohérent avec l'écosystème Playwright des
// helpers (et permettre d'ajouter des `test.fixme`/annotations futures sans
// re-toucher les imports). Référence neutre pour éviter le warn unused.
void test;
