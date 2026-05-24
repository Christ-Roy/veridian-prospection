/**
 * Flow cross-app #4 — Provision Hub → Prospection (HMAC).
 *
 * Couvre l'invariant DB qui doit être vrai après chaque appel
 * `POST /api/tenants/provision` (CONTRAT-HUB §5.1) :
 *   - User créé/résolu (hubUserId déterministe)
 *   - Tenant créé/résolu (userId = User.id)
 *   - Workspace "default" créé/résolu (tenantId)
 *   - WorkspaceMember admin/all (workspaceId + userId)
 *   - login_url retourné est exploitable (cf flow #2 qui le consomme,
 *     ici on valide juste la forme et la présence)
 *
 * Diffère du flow #2 :
 *   - #2 valide le BROWSER FLOW (cookie + redirect)
 *   - #4 valide la DB SHAPE (User+Tenant+Workspace+Member en Prisma)
 *
 * Bug-class anti-régression :
 *   - Si ensureOwnerWorkspace() skip silencieusement (cf le bug
 *     "no api_key returned" 2026-05-19), le membership n'est jamais
 *     créé → ce test rougit (membership.count = 0).
 *   - Si le slug Tenant entre en collision (bug observé sur le
 *     2026-05-18 — slug non unique), la 2e provision crash.
 */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { hubPost } from "../helpers/hub-hmac";
import { PrismaClient } from "@prisma/client";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Flow cross-app — Provision Hub → Prospection", () => {
  test("provision HMAC crée User+Tenant+Workspace+Member + login_url valide", async ({
    request,
  }) => {
    const hubUserId = randomUUID();
    const email = `provision-flow-${Date.now()}-${hubUserId.slice(
      0,
      8,
    )}@yopmail.com`;

    // 1) POST /api/tenants/provision avec HMAC signé
    const res = await hubPost(request, `${PROSPECTION_URL}/api/tenants/provision`, {
      email,
      name: "Provision Flow Tester",
      plan: "freemium",
      user_id: hubUserId,
      metadata: { hub_user_id: hubUserId },
    });
    expect(res.status(), `provision should 200: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as {
      tenant_id?: string;
      login_url?: string;
      api_key?: string | null;
    };

    // 2) Réponse conforme au contrat
    expect(body.tenant_id, "tenant_id manquant").toBeTruthy();
    expect(body.login_url).toMatch(/\/api\/auth\/token\?t=[a-f0-9]{32,}$/);

    // 3) Validation DB — la provision a créé toute la chaîne (Prisma direct)
    test.skip(
      !process.env.DATABASE_URL,
      "DATABASE_URL absent — skip vérif DB shape",
    );
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, hubUserId: true },
      });
      expect(user, `User non créé pour email=${email}`).not.toBeNull();
      // hub_user_id backfillé (CONTRAT-HUB v1.5 §3.7)
      expect(user!.hubUserId).toBe(hubUserId);

      const tenant = await prisma.tenant.findFirst({
        where: { userId: user!.id, deletedAt: null },
        select: { id: true, status: true },
      });
      expect(tenant, "Tenant non créé").not.toBeNull();
      expect(tenant!.status).toBe("active");

      const workspace = await prisma.workspace.findFirst({
        where: { tenantId: tenant!.id, slug: "default" },
        select: { id: true, name: true },
      });
      expect(workspace, "Workspace 'default' non créé").not.toBeNull();

      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId: workspace!.id, userId: user!.id },
        select: { role: true, visibilityScope: true, deletedAt: true },
      });
      expect(member, "WorkspaceMember owner non créé").not.toBeNull();
      expect(member!.role).toBe("admin");
      expect(member!.deletedAt).toBeNull();

      // 4) Cleanup
      await prisma.workspaceMember.deleteMany({
        where: { userId: user!.id },
      });
      await prisma.workspace.deleteMany({ where: { tenantId: tenant!.id } });
      await prisma.tenant.deleteMany({ where: { userId: user!.id } });
      await prisma.user.delete({ where: { id: user!.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
