/**
 * Flow cross-app #5 — Welcome leads grant (Hub → Prospection).
 *
 * Couvre POST /api/tenants/{id}/credit-leads (CONTRAT-BILLING §8.4) avec
 * source='welcome' — Hub crédite les leads offerts à la souscription et
 * aux upgrades de palier.
 *
 * Invariants protégés :
 *   1. Premier grant freemium → +100 sur leadsCredited
 *   2. Replay (idempotency key DIFFÉRENTE, même palier) → 200 no-op,
 *      pas de double-grant (anti-bug §8.4 protégé par UNIQUE
 *      (workspace_id, welcome_plan))
 *   3. Replay (idempotency key IDENTIQUE) → 200 no-op (idempotence
 *      standard)
 *   4. Upgrade vers 'pro' → +1900 (DELTA pro-freemium = 2000 - 100),
 *      pas +2000 (le Hub envoie ce qui manque, pas le solde cible)
 *
 * Pourquoi en E2E :
 *   - Plusieurs gardes (Zod schema + double idempotence DB + transaction
 *     Prisma) qu'un mock unitaire raterait.
 *   - Le bug class historique (cf incident "double welcome grant" 2026)
 *     se manifeste dans la DB, pas dans la logique pure.
 */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { hubPost } from "../helpers/hub-hmac";
import { PrismaClient } from "@prisma/client";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Flow cross-app — Welcome leads grant", () => {
  test("welcome freemium → +100, replay no-op, upgrade pro → +1900", async ({
    request,
  }) => {
    test.skip(
      !process.env.DATABASE_URL,
      "DATABASE_URL absent — flow welcome leads exige accès Prisma direct",
    );

    // 0) Provisionne un tenant frais pour cette run (isolation totale —
    //    si on retombait sur un tenant pré-existant ayant déjà reçu un
    //    welcome freemium, l'assert step 1 rougirait à tort).
    const hubUserId = randomUUID();
    const email = `welcome-flow-${Date.now()}-${hubUserId.slice(0, 8)}@yopmail.com`;
    const provisionRes = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/provision`,
      {
        email,
        name: "Welcome Flow Tester",
        plan: "freemium",
        user_id: hubUserId,
        metadata: { hub_user_id: hubUserId },
      },
    );
    expect(provisionRes.status()).toBe(200);
    // NB : provision retourne `tenant_id: <email>` (cf provision/route.ts)
    // pour rester compat avec le Hub historique. L'URL `/api/tenants/{id}`
    // accepte ce alias via resolveTenantByIdOrEmail. Mais pour les
    // requêtes Prisma directes il faut le vrai UUID — qu'on retrouve via
    // l'email de l'owner User → Tenant.
    const tenantRef = email; // alias accepté par les endpoints HTTP

    const prisma = new PrismaClient();
    try {
      // Résout le vrai tenantId UUID via le User créé par la provision
      const ownerUser = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });
      const tenantRow = await prisma.tenant.findFirstOrThrow({
        where: { userId: ownerUser.id, deletedAt: null },
        select: { id: true },
      });
      const tenantUuid = tenantRow.id;

      // Workspace default du tenant — c'est lui qui porte leadsCredited
      const workspace = await prisma.workspace.findFirstOrThrow({
        where: { tenantId: tenantUuid, slug: "default" },
        select: { id: true, leadsCredited: true },
      });
      const baselineCredited = workspace.leadsCredited;

      // 1) Premier grant welcome freemium → +100
      const grant1 = await hubPost(
        request,
        `${PROSPECTION_URL}/api/tenants/${tenantRef}/credit-leads`,
        {
          quantity: 100,
          source: "welcome",
          welcome_plan: "freemium",
          idempotency_key: randomUUID(),
          contract_version: "2.0",
        },
      );
      expect(grant1.status(), `grant1 freemium: ${await grant1.text()}`).toBe(
        200,
      );

      const after1 = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
        select: { leadsCredited: true },
      });
      expect(after1.leadsCredited).toBe(baselineCredited + 100);

      // 2) Replay avec idempotency key DIFFÉRENTE mais même palier
      //    → 200 no-op (UNIQUE (workspace_id, welcome_plan) bloque)
      const grant1bis = await hubPost(
        request,
        `${PROSPECTION_URL}/api/tenants/${tenantRef}/credit-leads`,
        {
          quantity: 100,
          source: "welcome",
          welcome_plan: "freemium",
          idempotency_key: randomUUID(), // DIFFÉRENTE
          contract_version: "2.0",
        },
      );
      expect(grant1bis.status()).toBe(200);
      const after1bis = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
        select: { leadsCredited: true },
      });
      expect(
        after1bis.leadsCredited,
        "double-grant détecté — UNIQUE (ws,welcome_plan) cassé",
      ).toBe(baselineCredited + 100);

      // 3) Replay avec MÊME idempotency key → 200 no-op standard
      const sharedKey = randomUUID();
      const grant3a = await hubPost(
        request,
        `${PROSPECTION_URL}/api/tenants/${tenantRef}/credit-leads`,
        {
          quantity: 1900,
          source: "welcome",
          welcome_plan: "pro",
          idempotency_key: sharedKey,
          contract_version: "2.0",
        },
      );
      expect(grant3a.status()).toBe(200);
      const after3a = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
        select: { leadsCredited: true },
      });
      // Upgrade pro = +1900 (DELTA)
      expect(after3a.leadsCredited).toBe(baselineCredited + 100 + 1900);

      const grant3b = await hubPost(
        request,
        `${PROSPECTION_URL}/api/tenants/${tenantRef}/credit-leads`,
        {
          quantity: 1900,
          source: "welcome",
          welcome_plan: "pro",
          idempotency_key: sharedKey, // IDENTIQUE
          contract_version: "2.0",
        },
      );
      expect(grant3b.status()).toBe(200);
      const after3b = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspace.id },
        select: { leadsCredited: true },
      });
      expect(
        after3b.leadsCredited,
        "idempotency_key UNIQUE ne protège plus",
      ).toBe(baselineCredited + 100 + 1900);

      // 4) Audit DB — 2 events welcome distincts (freemium + pro), pas de
      //    duplicats
      const events = await prisma.leadCreditEvent.findMany({
        where: { workspaceId: workspace.id, source: "welcome" },
        select: { welcomePlan: true, quantity: true },
        orderBy: { createdAt: "asc" },
      });
      const plans = events.map((e) => e.welcomePlan).sort();
      expect(plans).toEqual(["freemium", "pro"]);
      expect(events.find((e) => e.welcomePlan === "freemium")?.quantity).toBe(100);
      expect(events.find((e) => e.welcomePlan === "pro")?.quantity).toBe(1900);

      // 5) Cleanup
      await prisma.leadCreditEvent.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: workspace.id },
      });
      await prisma.workspace.deleteMany({ where: { tenantId: tenantUuid } });
      await prisma.tenant.deleteMany({ where: { id: tenantUuid } });
      await prisma.user.deleteMany({ where: { email } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
