/**
 * Cross-app login helper — provisionne un tenant éphémère via HMAC Hub
 * puis consomme le `login_url` (one-shot `/api/auth/token?t=...`) pour
 * obtenir un cookie session Auth.js sur un BrowserContext Playwright.
 *
 * Utilisé en staging où Supabase n'est pas configuré (cf `auth.ts` Supabase
 * helper qui dépend de SUPABASE_URL absent en staging). Le flow magic-link
 * est la voie d'auth officielle Hub → Prospection (cf §5.1 + §5.6).
 *
 * Le tenant créé n'est PAS supprimé en fin de test : il est laissé en état
 * actif pour que d'autres specs puissent l'auditer. La staging DB est de
 * toute façon clonée régulièrement, le bruit reste cantonné.
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { hubPost } from "./hub-hmac";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

export type ProvisionedTenant = {
  email: string;
  hubUserId: string;
  tenantRef: string; // ce que le Hub mémorise (peut être email ou UUID local)
  loginUrl: string;
};

export async function provisionEphemeralTenant(
  request: APIRequestContext,
  options: { plan?: string } = {},
): Promise<ProvisionedTenant> {
  const hubUserId = randomUUID();
  const email = `e2e-${Date.now()}-${hubUserId.slice(0, 8)}@yopmail.com`;
  const res = await hubPost(request, `${PROSPECTION_URL}/api/tenants/provision`, {
    email,
    name: `e2e-cross-app-${Date.now()}`,
    plan: options.plan ?? "freemium",
    user_id: hubUserId,
  });
  if (!res.ok()) {
    throw new Error(
      `provision failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    tenant_id?: string;
    login_url?: string;
  };
  if (!body.tenant_id || !body.login_url) {
    throw new Error(
      `provision response missing tenant_id/login_url: ${JSON.stringify(body)}`,
    );
  }
  return {
    email,
    hubUserId,
    tenantRef: body.tenant_id,
    loginUrl: body.login_url,
  };
}

/**
 * Consume le login_url one-shot dans un BrowserContext (ne pas réutiliser
 * une page déjà loggée). Retourne quand la page est sur `/` ou `/prospects`.
 */
export async function consumeLoginUrl(
  context: BrowserContext,
  loginUrl: string,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(loginUrl);
  await page
    .waitForURL((url) => !url.toString().includes("/api/auth/token"), {
      timeout: 15000,
    })
    .catch(() => {});
  if (page.url().includes("/login?error=")) {
    throw new Error(`Login failed: ${page.url()}`);
  }
  await page.close();
}

/**
 * Combo : provision + login. Retourne le contexte loggué + les infos tenant.
 *
 * Utilise un context dédié (pas le browser context par défaut) pour isoler
 * les cookies de session par test.
 */
export async function provisionAndLogin(
  request: APIRequestContext,
  context: BrowserContext,
  options: { plan?: string } = {},
): Promise<ProvisionedTenant> {
  const tenant = await provisionEphemeralTenant(request, options);
  await consumeLoginUrl(context, tenant.loginUrl);
  return tenant;
}
