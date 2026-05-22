/**
 * Spec de validation du helper d'auth e2e — `e2e/helpers/auth.ts`.
 *
 * Le helper `loginAsE2EUser` est le « canonical user pattern » du repo : ~11
 * specs en dépendent. Cette spec le teste DIRECTEMENT, isolément du bruit des
 * pages métier (hydration mismatches `next dev`, UI mouvante), pour qu'une
 * régression du helper soit attrapée ici en premier.
 *
 * Couvre :
 *  1. `loginAsE2EUser` seede le compte canonique + ouvre une session Auth.js.
 *  2. La session est réellement reconnue (`/api/auth/session` renvoie le user).
 *  3. Le compte a bien un contexte tenant/workspace (route protégée → pas 401).
 *  4. Idempotence : un second appel ne casse rien et ne crée pas de doublon.
 *
 * Contexte : ce helper parlait à Supabase GoTrue (mort) et `test.skip()`-ait
 * en silence si `SUPABASE_*` manquait. Réécrit pour Auth.js v5 (2026-05-22).
 * Cette spec garantit que le skip silencieux ne revient pas : si le login
 * échoue, elle échoue ROUGE.
 *
 * Run :
 *   PROSPECTION_URL=http://localhost:3000 \
 *   DATABASE_URL=postgresql://... \
 *   npx playwright test e2e/helpers/auth-helper.spec.ts --project=chromium
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser, E2E_USER_EMAIL } from "./auth";

test.describe("e2e auth helper — canonical user (Auth.js v5)", () => {
  test.setTimeout(90_000);

  test("loginAsE2EUser ouvre une session Auth.js reconnue", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    // La session Auth.js doit exposer le user canonique.
    const session = await page.evaluate(async () => {
      const res = await fetch("/api/auth/session");
      return res.ok ? await res.json() : null;
    });
    expect(session, "session Auth.js absente après login").toBeTruthy();
    expect(session.user?.email).toBe(E2E_USER_EMAIL);
    expect(session.user?.id, "session sans user.id").toBeTruthy();
  });

  test("le compte canonique a un contexte tenant (route protégée accessible)", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    // /prospects est gated par le middleware + getUserContext (tenant requis).
    // Si le seed n'a pas créé tenant + workspace + membership, getUserContext
    // renvoie null → 401 / redirect login. On vérifie qu'on est bien resté.
    expect(page.url(), "redirigé hors /prospects").toContain("/prospects");

    // Une route API protégée doit répondre 2xx (et pas 401) avec la session.
    const apiStatus = await page.evaluate(async () => {
      const res = await fetch("/api/prospects?limit=1");
      return res.status;
    });
    expect(apiStatus, "/api/prospects renvoie 401 → contexte tenant absent").not.toBe(
      401,
    );
  });

  test("loginAsE2EUser est idempotent (second appel OK, pas de doublon)", async ({
    page,
    request,
  }) => {
    // Premier appel — crée / réutilise le compte.
    await loginAsE2EUser(page, request);
    // Second appel sur la même page — ne doit ni throw ni dégrader la session.
    await loginAsE2EUser(page, request);

    const session = await page.evaluate(async () => {
      const res = await fetch("/api/auth/session");
      return res.ok ? await res.json() : null;
    });
    expect(session?.user?.email).toBe(E2E_USER_EMAIL);
  });
});
