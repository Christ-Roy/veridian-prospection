/**
 * Tests unitaires de src/lib/queries/lead-credits.ts — quota refill leads.
 *
 * Couvre la logique de branchement et le calcul du solde avec Prisma mocké :
 *  - getLeadBalance : solde = credited - consumed, cas workspace absent/null.
 *  - consumeLead : garde workspaceId null, décompte conditionnel selon que la
 *    ligne lead_consumption a été insérée (1re consultation) ou pas (replay).
 *
 * L'idempotence SQL réelle (ON CONFLICT DO NOTHING contre une vraie DB) est
 * vérifiée en plus dans e2e/integration/lead-refill.test.ts — ici on
 * verrouille que le code décide correctement à partir du résultat du INSERT.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceFindUnique: vi.fn(),
  workspaceUpdate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspace: {
      findUnique: mocks.workspaceFindUnique,
      update: mocks.workspaceUpdate,
    },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

import { consumeLead, getLeadBalance } from "@/lib/queries/lead-credits";

/**
 * Branche $transaction : exécute le callback avec un `tx` exposant
 * $queryRaw + workspace.update mockés.
 */
function wireTransaction() {
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      $queryRaw: mocks.queryRaw,
      workspace: { update: mocks.workspaceUpdate },
    }),
  );
}

describe("getLeadBalance", () => {
  beforeEach(() => vi.clearAllMocks());

  test("solde = credited - consumed", async () => {
    mocks.workspaceFindUnique.mockResolvedValue({
      leadsCredited: 5000,
      leadsConsumed: 1200,
    });
    const bal = await getLeadBalance("ws-1");
    expect(bal.credited).toBe(5000);
    expect(bal.consumed).toBe(1200);
    expect(bal.balance).toBe(3800);
  });

  test("solde négatif possible si consumed > credited (pas de clamp)", async () => {
    // Le backend n'invente pas de plancher : le solde reflète l'état réel.
    // Le traitement d'un solde ≤ 0 est une décision UX (cf ticket).
    mocks.workspaceFindUnique.mockResolvedValue({
      leadsCredited: 100,
      leadsConsumed: 150,
    });
    const bal = await getLeadBalance("ws-1");
    expect(bal.balance).toBe(-50);
  });

  test("workspaceId null → solde neutre, pas de hit DB", async () => {
    const bal = await getLeadBalance(null);
    expect(bal).toEqual({ credited: 0, consumed: 0, balance: 0 });
    expect(mocks.workspaceFindUnique).not.toHaveBeenCalled();
  });

  test("workspace introuvable → solde neutre", async () => {
    mocks.workspaceFindUnique.mockResolvedValue(null);
    const bal = await getLeadBalance("ws-inexistant");
    expect(bal).toEqual({ credited: 0, consumed: 0, balance: 0 });
  });
});

describe("consumeLead", () => {
  beforeEach(() => vi.clearAllMocks());

  test("workspaceId null → no-op, pas de transaction", async () => {
    const consumed = await consumeLead("123456789", "tenant-1", null);
    expect(consumed).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  test("1re consultation (INSERT a inséré une ligne) → décompte 1 lead", async () => {
    wireTransaction();
    // Le INSERT ... RETURNING renvoie une ligne = row neuve.
    mocks.queryRaw.mockResolvedValue([{ siren: "123456789" }]);
    mocks.workspaceUpdate.mockResolvedValue({});

    const consumed = await consumeLead("123456789", "tenant-1", "ws-1");
    expect(consumed).toBe(true);
    // leadsConsumed incrémenté de 1 sur le bon workspace.
    expect(mocks.workspaceUpdate).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { leadsConsumed: { increment: 1 } },
    });
  });

  test("fiche déjà consommée (INSERT sans RETURNING) → no-op, pas de décompte", async () => {
    wireTransaction();
    // ON CONFLICT DO NOTHING → aucune ligne renvoyée.
    mocks.queryRaw.mockResolvedValue([]);

    const consumed = await consumeLead("123456789", "tenant-1", "ws-1");
    expect(consumed).toBe(false);
    // Pas de double décompte — le compteur n'est pas touché.
    expect(mocks.workspaceUpdate).not.toHaveBeenCalled();
  });
});
