/**
 * Tests POST /api/tenants/{id}/credit-leads — refill leads
 * (tickets refill 1/3 endpoint + 2/3 welcome leads).
 *
 * Couvre :
 *  - 401 HMAC absent / signature bidon
 *  - 422 invalid_body (champ requis manquant, type faux, quantity ≤ 0,
 *    welcome sans welcome_plan, purchase avec welcome_plan, welcome_plan
 *    hors enum)
 *  - 400 invalid_payload (contract_version major inconnu)
 *  - 404 tenant_not_found (tenant absent OU sans workspace)
 *  - 200 crédite + balance correcte (purchase + welcome)
 *  - 200 idempotent — replay du même idempotency_key crédite une seule fois
 *  - 200 anti-double-grant welcome — second grant pour un palier déjà
 *    crédité (P2002 sur l'index (workspace, welcome_plan)) = no-op,
 *    credited=0, solde inchangé
 *  - welcome_plan persisté en DB sur la ligne d'historique
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-credit-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  workspaceFindFirst: vi.fn(),
  workspaceFindUnique: vi.fn(),
  workspaceUpdate: vi.fn(),
  leadCreditEventCreate: vi.fn(),
  leadOrderCreate: vi.fn(),
  transaction: vi.fn(),
  resolveTenant: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspace: {
      findFirst: mocks.workspaceFindFirst,
      findUnique: mocks.workspaceFindUnique,
      update: mocks.workspaceUpdate,
    },
    leadCreditEvent: { create: mocks.leadCreditEventCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/hub/tenant-lookup", () => ({
  resolveTenantByIdOrEmail: mocks.resolveTenant,
}));

vi.mock("@/lib/audit", () => ({ logAudit: mocks.auditLog }));

import { Prisma } from "@prisma/client";
import { POST } from "@/app/api/tenants/[id]/credit-leads/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-credit-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const WS_ID = "44444444-4444-4444-8444-444444444444";
const IDEM_KEY = "55555555-5555-4555-8555-555555555555";

function signed(body: object) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return {
    raw,
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
  };
}

function req(raw: string, headers: Record<string, string>, tenantId = TENANT_ID) {
  return makeRequest(`/api/tenants/${tenantId}/credit-leads`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function ctx(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ id: tenantId }) };
}

const validBody = {
  quantity: 5000,
  source: "purchase" as const,
  idempotency_key: IDEM_KEY,
  stripe_payment_id: "pi_test_123",
  contract_version: "2.0",
};

/**
 * Branche $transaction : exécute le callback avec un `tx` qui expose
 * leadCreditEvent.create + leadOrder.create + workspace.update mockés.
 * leadOrder.create n'est appelé que pour source=purchase (cf route v2.1).
 */
function wireTransaction() {
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      leadCreditEvent: { create: mocks.leadCreditEventCreate },
      leadOrder: { create: mocks.leadOrderCreate },
      workspace: { update: mocks.workspaceUpdate },
    }),
  );
}

describe("POST /api/tenants/[id]/credit-leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("401 Unauthorized si HMAC absent", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/credit-leads`, {
      method: "POST",
      body: validBody,
    });
    const res = await POST(r, ctx());
    expect(res.status).toBe(401);
    // Auth refusée → aucune résolution de tenant, aucune écriture.
    expect(mocks.resolveTenant).not.toHaveBeenCalled();
  });

  test("401 si signature HMAC bidon", async () => {
    const { raw } = signed(validBody);
    const res = await POST(
      req(raw, {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "deadbeef",
      }),
      ctx(),
    );
    expect(res.status).toBe(401);
    expect(mocks.resolveTenant).not.toHaveBeenCalled();
  });

  test("422 invalid_body si quantity manquante", async () => {
    const { raw, headers } = signed({
      source: "purchase",
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_body");
    expect(mocks.resolveTenant).not.toHaveBeenCalled();
  });

  test("422 invalid_body si quantity ≤ 0", async () => {
    const { raw, headers } = signed({ ...validBody, quantity: 0 });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
  });

  test("422 invalid_body si quantity négative", async () => {
    const { raw, headers } = signed({ ...validBody, quantity: -100 });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
  });

  test("422 invalid_body si source hors enum", async () => {
    const { raw, headers } = signed({ ...validBody, source: "cadeau" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
  });

  test("422 invalid_body si idempotency_key n'est pas un uuid", async () => {
    const { raw, headers } = signed({ ...validBody, idempotency_key: "abc" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
  });

  test("400 invalid_payload si contract_version major inconnu", async () => {
    const { raw, headers } = signed({ ...validBody, contract_version: "1.0" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_payload");
    // Validation amont → tenant jamais résolu.
    expect(mocks.resolveTenant).not.toHaveBeenCalled();
  });

  test("404 tenant_not_found si tenant absent", async () => {
    mocks.resolveTenant.mockResolvedValue(null);
    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_found");
    // Tenant absent → aucun crédit.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  test("404 tenant_not_found si tenant sans workspace actif", async () => {
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue(null);
    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  test("200 crédite + balance correcte (credited - consumed)", async () => {
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 1000,
      leadsConsumed: 200,
    });
    wireTransaction();
    mocks.leadCreditEventCreate.mockResolvedValue({});
    // Après increment : 1000 + 5000 = 6000 credited, 200 consumed.
    mocks.workspaceUpdate.mockResolvedValue({
      leadsCredited: 6000,
      leadsConsumed: 200,
    });

    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      balance: number;
    };
    expect(body.credited).toBe(5000);
    expect(body.balance).toBe(5800); // 6000 - 200

    // L'historique est inséré avec les bons champs.
    expect(mocks.leadCreditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: WS_ID,
        tenantId: TENANT_ID,
        quantity: 5000,
        source: "purchase",
        idempotencyKey: IDEM_KEY,
        stripePaymentId: "pi_test_123",
        contractVersion: "2.0",
      }),
    });
    // Le compteur est incrémenté de quantity.
    expect(mocks.workspaceUpdate).toHaveBeenCalledWith({
      where: { id: WS_ID },
      data: { leadsCredited: { increment: 5000 } },
      select: { leadsCredited: true, leadsConsumed: true },
    });
    // Audit log émis.
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.leads_credited",
        actorType: "hub",
        tenantId: TENANT_ID,
      }),
    );
  });

  test("200 idempotent — replay du même idempotency_key crédite une seule fois", async () => {
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 6000,
      leadsConsumed: 200,
    });
    // La transaction throw P2002 — l'idempotency_key existe déjà.
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.x",
      }),
    );
    // Le handler relit le solde courant après le conflit.
    mocks.workspaceFindUnique.mockResolvedValue({
      leadsCredited: 6000,
      leadsConsumed: 200,
    });

    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      balance: number;
      idempotent_replay: boolean;
    };
    expect(body.idempotent_replay).toBe(true);
    // Solde inchangé : le crédit n'a PAS été ré-appliqué.
    expect(body.balance).toBe(5800);
    // Pas de double audit sur un replay.
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  test("200 — stripe_payment_id optionnel (welcome leads sans paiement)", async () => {
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 0,
      leadsConsumed: 0,
    });
    wireTransaction();
    mocks.leadCreditEventCreate.mockResolvedValue({});
    mocks.workspaceUpdate.mockResolvedValue({
      leadsCredited: 100,
      leadsConsumed: 0,
    });

    const { raw, headers } = signed({
      quantity: 100,
      source: "welcome",
      welcome_plan: "freemium",
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    expect(mocks.leadCreditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: "welcome",
        stripePaymentId: null,
      }),
    });
  });

  // ── Welcome leads — ticket refill 2/3 ──────────────────────────────────────

  test("422 invalid_body si source='welcome' sans welcome_plan", async () => {
    // Un grant welcome doit toujours porter son palier : sans lui,
    // l'anti-double-grant ne peut pas opérer.
    const { raw, headers } = signed({
      quantity: 100,
      source: "welcome",
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_body");
    expect(mocks.resolveTenant).not.toHaveBeenCalled();
  });

  test("422 invalid_body si source='purchase' AVEC welcome_plan", async () => {
    // Un achat n'a pas de palier — welcome_plan sur un purchase = payload
    // incohérent, on rejette plutôt que de l'ignorer silencieusement.
    const { raw, headers } = signed({
      ...validBody,
      welcome_plan: "pro",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
  });

  test("422 invalid_body si welcome_plan hors enum", async () => {
    const { raw, headers } = signed({
      quantity: 100,
      source: "welcome",
      welcome_plan: "enterprise", // pas un palier Prospection local
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
  });

  test("200 welcome — provision Free crédite 100 leads, solde = 100", async () => {
    // Scénario ticket : nouveau tenant Freemium → +100 welcome leads.
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 0,
      leadsConsumed: 0,
    });
    wireTransaction();
    mocks.leadCreditEventCreate.mockResolvedValue({});
    mocks.workspaceUpdate.mockResolvedValue({
      leadsCredited: 100,
      leadsConsumed: 0,
    });

    const { raw, headers } = signed({
      quantity: 100,
      source: "welcome",
      welcome_plan: "freemium",
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      balance: number;
    };
    expect(body.credited).toBe(100);
    expect(body.balance).toBe(100);
    // welcome_plan persisté sur la ligne d'historique — c'est lui qui porte
    // l'invariant anti-double-grant en DB.
    expect(mocks.leadCreditEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: "welcome",
        welcomePlan: "freemium",
        quantity: 100,
      }),
    });
    // L'audit log trace le palier.
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.leads_credited",
        metadata: expect.objectContaining({ welcome_plan: "freemium" }),
      }),
    );
  });

  test("200 welcome — upgrade Free→Pro crédite le delta (+1 900), pas +2 000", async () => {
    // Le Hub envoie le DELTA entre paliers : Free a déjà donné 100, l'upgrade
    // Pro crédite 1 900 pour atteindre les 2 000 du palier Pro. Le palier
    // welcome porté ici = 'pro' (distinct de 'freemium' déjà crédité).
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 100, // 100 welcome Free déjà crédités
      leadsConsumed: 0,
    });
    wireTransaction();
    mocks.leadCreditEventCreate.mockResolvedValue({});
    mocks.workspaceUpdate.mockResolvedValue({
      leadsCredited: 2000, // 100 + 1900
      leadsConsumed: 0,
    });

    const { raw, headers } = signed({
      quantity: 1900,
      source: "welcome",
      welcome_plan: "pro",
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      balance: number;
    };
    expect(body.credited).toBe(1900);
    // Solde Pro atteint : 2 000, pas 2 100 (pas de double compte du Free).
    expect(body.balance).toBe(2000);
    expect(mocks.workspaceUpdate).toHaveBeenCalledWith({
      where: { id: WS_ID },
      data: { leadsCredited: { increment: 1900 } },
      select: { leadsCredited: true, leadsConsumed: true },
    });
  });

  test("200 anti-double-grant — second welcome pour le même palier = no-op (P2002 welcome_plan)", async () => {
    // Le Hub réémet par erreur un grant welcome 'pro' (retry buggé,
    // re-provision) avec une idempotency_key DIFFÉRENTE. L'index unique
    // (workspace_id, welcome_plan) attrape le doublon → P2002 ciblant
    // welcome_plan → no-op, credited=0, solde inchangé.
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 2000, // palier Pro déjà crédité
      leadsConsumed: 350,
    });
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.x",
        meta: {
          target: ["workspace_id", "welcome_plan"],
        },
      }),
    );
    mocks.workspaceFindUnique.mockResolvedValue({
      leadsCredited: 2000,
      leadsConsumed: 350,
    });

    const { raw, headers } = signed({
      quantity: 1900,
      source: "welcome",
      welcome_plan: "pro",
      idempotency_key: "99999999-9999-4999-8999-999999999999", // clé NEUVE
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      balance: number;
      idempotent_replay: boolean;
    };
    expect(body.idempotent_replay).toBe(true);
    // Rien crédité cette fois — le palier Pro avait déjà son welcome.
    expect(body.credited).toBe(0);
    // Solde inchangé : 2000 - 350 = 1650.
    expect(body.balance).toBe(1650);
    // Pas de double audit.
    expect(mocks.auditLog).not.toHaveBeenCalled();
  });

  test("200 idempotent — replay du même idempotency_key sur un welcome crédite une seule fois", async () => {
    // Replay STRICT : même idempotency_key. P2002 cible idempotency_key
    // (pas welcome_plan) → credited reflète la quantité du signal d'origine.
    mocks.resolveTenant.mockResolvedValue({ id: TENANT_ID, userId: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValue({
      id: WS_ID,
      leadsCredited: 100,
      leadsConsumed: 0,
    });
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.x",
        meta: { target: ["idempotency_key"] },
      }),
    );
    mocks.workspaceFindUnique.mockResolvedValue({
      leadsCredited: 100,
      leadsConsumed: 0,
    });

    const { raw, headers } = signed({
      quantity: 100,
      source: "welcome",
      welcome_plan: "freemium",
      idempotency_key: IDEM_KEY,
      contract_version: "2.0",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      balance: number;
      idempotent_replay: boolean;
    };
    expect(body.idempotent_replay).toBe(true);
    // Replay strict : credited = quantité d'origine (déjà appliquée).
    expect(body.credited).toBe(100);
    expect(body.balance).toBe(100);
  });
});
