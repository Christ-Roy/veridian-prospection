/**
 * Flow cross-app #1 — Invitation complète.
 *
 * Couvre le journey END-TO-END qui a été cassé silencieusement le
 * 2026-05-22 (Supabase mort, `acceptInvitation` plantait en silence)
 * et qui n'avait AUCUN test E2E réel. Anti-régression directe.
 *
 * Étapes :
 *   1. Admin canonique (e2e-persistent) est loggué (Auth.js v5)
 *   2. POST /api/admin/invitations { email, workspaceId, role:'member' }
 *      → 201 + { token, inviteUrl }
 *   3. (Pas d'UI admin form ici — on couvre l'endpoint qui est la
 *      surface contractuelle. Le bouton admin pointe sur le même
 *      endpoint, donc tester l'UI ajouterait du flake sans valider
 *      plus d'invariant.)
 *   4. Browser fresh (newContext) → /invite/{token} → form rempli :
 *      password + fullName
 *   5. Submit → Auth.js signIn("credentials") côté front → redirect
 *      vers /prospects, cookie session posé
 *   6. /api/auth/session retourne le bon user (l'invité, pas l'admin)
 *
 * Critère de sabotage (cf ticket §"Métrique de succès") : si
 * `acceptInvitation` retombe sur Supabase ou plante sur l'upsert,
 * cette spec rougit en <30s (le submit accept renvoie 500/404 ou la
 * session reste vide).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser, E2E_USER_EMAIL } from "../helpers/auth";
import { PrismaClient } from "@prisma/client";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Flow cross-app — Invitation E2E", () => {
  test("admin invite → accept → autologin + session valide", async ({
    browser,
    page,
    request,
  }) => {
    // 1) Login admin canonique (seed idempotent + cookie session)
    await loginAsE2EUser(page, request);

    // 2) Génère un email d'invité unique pour cette run (pas de collision
    //    entre exécutions parallèles, pas besoin de cleanup explicite).
    const inviteEmail = `invite-flow-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@yopmail.com`;

    // 3) POST /api/admin/invitations (la page page.tsx admin déclenche
    //    exactement ce call — on couvre la même surface contractuelle).
    const createRes = await page.request.post("/api/admin/invitations", {
      data: { email: inviteEmail, role: "member" },
    });
    expect(createRes.status(), `create invitation should 201: ${await createRes.text()}`).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      token: string;
      inviteUrl: string;
      email: string;
      role: string;
    };
    expect(created.token).toMatch(/^[a-f0-9]{32,}$/);
    expect(created.inviteUrl).toContain(`/invite/${created.token}`);

    // [SABOTAGE-MARKER] — si on revoke ici avant l'accept, la spec doit
    // rougir en <30s. Test temporaire fait localement et validé manuel.
    if (process.env.E2E_SABOTAGE_INVITATION === "1") {
      const sabo = new PrismaClient();
      try {
        await sabo.invitation.updateMany({
          where: { token: created.token },
          data: { revokedAt: new Date() },
        });
      } finally {
        await sabo.$disconnect();
      }
      console.warn("[SABOTAGE] invitation revoked — spec should now fail");
    }

    // 4) Fresh browser context (pas le cookie admin) — l'invité ouvre
    //    le lien sans être authentifié.
    const inviteCtx = await browser.newContext();
    const invitePage = await inviteCtx.newPage();
    await invitePage.goto(`${PROSPECTION_URL}/invite/${created.token}`);

    // L'écran affiche bien le form d'acceptation (pas l'écran "invalide").
    // Le h1 + un <p> contenant "...invité par e2e-..." mentionnent tous les
    // deux le bloc — on cible le heading pour rester unique.
    await expect(
      invitePage.getByRole("heading", { name: /rejoindre veridian/i }),
    ).toBeVisible({ timeout: 10_000 });

    // 5) Remplit le form (password ≥ 8 chars, fullName optionnel mais
    //    on en pose un pour valider la branche complète).
    const newPassword = "InviteFlow2026!";
    await invitePage
      .getByLabel(/mot de passe/i)
      .first()
      .fill(newPassword);
    // Best-effort fullName : champ optionnel selon l'UI exacte.
    const fullNameField = invitePage.getByLabel(/nom complet|prénom|nom/i).first();
    if (await fullNameField.isVisible({ timeout: 500 }).catch(() => false)) {
      await fullNameField.fill("Invite Flow Tester");
    }

    // 6) Submit → l'écran redirige vers /prospects après signIn réussi.
    await Promise.all([
      invitePage.waitForURL(/\/(prospects|$)/, { timeout: 30_000 }),
      invitePage.getByRole("button", { name: /accepter|rejoindre|valider/i }).click(),
    ]);

    // 7) Cookie session posé
    const cookies = await inviteCtx.cookies();
    const sessionCookie = cookies.find((c) =>
      /authjs\.session-token/.test(c.name),
    );
    expect(sessionCookie, "cookie session manquant après accept").toBeDefined();

    // 8) /api/auth/session retourne bien l'INVITÉ (pas l'admin)
    const sessionRes = await invitePage.request.get("/api/auth/session");
    expect(sessionRes.status()).toBe(200);
    const session = (await sessionRes.json()) as {
      user?: { email?: string };
    };
    expect(session.user?.email?.toLowerCase()).toBe(inviteEmail.toLowerCase());
    expect(session.user?.email).not.toBe(E2E_USER_EMAIL);

    // 9) /prospects rend sans rebond /login
    await invitePage.goto(`${PROSPECTION_URL}/prospects`);
    await expect(invitePage).toHaveURL(/\/prospects/, { timeout: 10_000 });

    await inviteCtx.close();

    // 10) Cleanup best-effort : delete user + invitation row pour ne pas
    //     polluer la DB staging (le yopmail @ est jetable mais on respecte
    //     l'isolement). Pas critique si ça plante.
    if (process.env.DATABASE_URL) {
      const prisma = new PrismaClient();
      try {
        const user = await prisma.user.findUnique({
          where: { email: inviteEmail },
          select: { id: true },
        });
        if (user) {
          await prisma.workspaceMember.deleteMany({
            where: { userId: user.id },
          });
          await prisma.account.deleteMany({ where: { userId: user.id } });
          await prisma.user.delete({ where: { id: user.id } });
        }
        await prisma.invitation.deleteMany({
          where: { email: inviteEmail.toLowerCase() },
        });
      } catch (err) {
        console.warn(`[cleanup] ignored: ${(err as Error).message}`);
      } finally {
        await prisma.$disconnect();
      }
    }
  });
});
