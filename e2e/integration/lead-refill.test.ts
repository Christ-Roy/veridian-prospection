/**
 * Integration tests — refill leads quota (ticket refill 1/3).
 *
 * Valide contre une vraie DB Postgres :
 *  - le schéma : colonnes leads_credited/leads_consumed + tables
 *    lead_credit_events / lead_consumption.
 *  - `consumeLead()` : décompte réel + idempotence par (workspace, siren).
 *  - `getLeadBalance()` : solde = credited - consumed.
 *  - l'idempotence du crédit : index UNIQUE sur idempotency_key.
 *
 * Chaque test est self-contained : crée ses données, asserte, nettoie.
 *
 * Run: npx vitest run e2e/integration/lead-refill.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { consumeLead, getLeadBalance } from "@/lib/queries/lead-credits";

const prisma = new PrismaClient();

const TENANT = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

// SIRENs fictifs — prefix 997 (distinct des autres fichiers integration).
// Layout : 997 (3) + RUN_ID (5) + suffixe (1) = 9 chiffres.
const RUN_ID = Date.now().toString().slice(-5);
const SIREN_1 = `997${RUN_ID}1`;
const SIREN_2 = `997${RUN_ID}2`;

let WS: string;
let skip = false;

beforeAll(async () => {
  try {
    await prisma.entreprise.createMany({
      data: [
        { siren: SIREN_1, denomination: `REFILL-TEST-1-${RUN_ID}` },
        { siren: SIREN_2, denomination: `REFILL-TEST-2-${RUN_ID}` },
      ],
      skipDuplicates: true,
    });
    const ws = await prisma.workspace.create({
      data: {
        tenantId: TENANT,
        name: "Refill-Test",
        slug: `refill-test-${Date.now()}`,
      },
    });
    WS = ws.id;
  } catch (err) {
    skip = true;
    console.warn("[lead-refill] setup failed:", err);
  }
});

afterAll(async () => {
  if (!skip) {
    // FK-safe : credit_events / consumption ont une FK CASCADE vers workspace,
    // mais on nettoie explicitement pour ne rien laisser traîner.
    await prisma.leadCreditEvent
      .deleteMany({ where: { tenantId: TENANT } })
      .catch(() => {});
    await prisma.leadConsumption
      .deleteMany({ where: { tenantId: TENANT } })
      .catch(() => {});
    await prisma.workspace
      .deleteMany({ where: { tenantId: TENANT } })
      .catch(() => {});
    await prisma.entreprise
      .deleteMany({ where: { siren: { in: [SIREN_1, SIREN_2] } } })
      .catch(() => {});
  }
  await prisma.$disconnect();
});

describe.skipIf(skip)("Refill leads — schéma quota", () => {
  it("workspace démarre avec un solde nul (defaults 0)", async () => {
    const ws = await prisma.workspace.findUnique({
      where: { id: WS },
      select: { leadsCredited: true, leadsConsumed: true },
    });
    expect(ws?.leadsCredited).toBe(0);
    expect(ws?.leadsConsumed).toBe(0);
  });

  it("lead_credit_events : idempotency_key UNIQUE rejette un doublon", async () => {
    const key = `idem-${RUN_ID}-dup`;
    await prisma.leadCreditEvent.create({
      data: {
        workspaceId: WS,
        tenantId: TENANT,
        quantity: 100,
        source: "purchase",
        idempotencyKey: key,
      },
    });
    // Même clé → viole la contrainte unique.
    await expect(
      prisma.leadCreditEvent.create({
        data: {
          workspaceId: WS,
          tenantId: TENANT,
          quantity: 100,
          source: "purchase",
          idempotencyKey: key,
        },
      }),
    ).rejects.toThrow();
    await prisma.leadCreditEvent.deleteMany({
      where: { idempotencyKey: key },
    });
  });
});

describe.skipIf(skip)("Refill leads — consumeLead (décompte idempotent)", () => {
  it("1re consultation d'une fiche : décompte 1 lead", async () => {
    const consumed = await consumeLead(SIREN_1, TENANT, WS);
    expect(consumed).toBe(true);

    const bal = await getLeadBalance(WS);
    expect(bal.consumed).toBe(1);

    // Une ligne lead_consumption a été créée.
    const rows = await prisma.leadConsumption.findMany({
      where: { workspaceId: WS, siren: SIREN_1 },
    });
    expect(rows).toHaveLength(1);
  });

  it("reconsulter la même fiche : pas de double décompte", async () => {
    // SIREN_1 a déjà été consommé au test précédent (consumed = 1).
    const before = await getLeadBalance(WS);
    const consumed = await consumeLead(SIREN_1, TENANT, WS);
    expect(consumed).toBe(false); // no-op

    const after = await getLeadBalance(WS);
    expect(after.consumed).toBe(before.consumed); // inchangé
  });

  it("une 2e fiche distincte : décompte un lead de plus", async () => {
    const before = await getLeadBalance(WS);
    const consumed = await consumeLead(SIREN_2, TENANT, WS);
    expect(consumed).toBe(true);

    const after = await getLeadBalance(WS);
    expect(after.consumed).toBe(before.consumed + 1);
  });

  it("sans workspace : no-op (pas de quota à décompter)", async () => {
    const consumed = await consumeLead(SIREN_1, TENANT, null);
    expect(consumed).toBe(false);
  });

  it("getLeadBalance : solde = credited - consumed", async () => {
    // Crédite 5000 leads sur le workspace.
    await prisma.workspace.update({
      where: { id: WS },
      data: { leadsCredited: { increment: 5000 } },
    });
    const bal = await getLeadBalance(WS);
    expect(bal.credited).toBe(5000);
    // 2 fiches distinctes consommées (SIREN_1, SIREN_2).
    expect(bal.consumed).toBe(2);
    expect(bal.balance).toBe(bal.credited - bal.consumed);
    expect(bal.balance).toBe(4998);
  });
});
