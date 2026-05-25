/**
 * Tests d'extension credit-leads pour v2.1 — `filters` (refill ICP).
 *
 * Couvre uniquement le NOUVEAU comportement ajouté par ce ticket :
 *  - 422 si `filters` envoyé avec source='welcome' (interdit, contrat v2.1)
 *  - 200 sans filters → comportement v2.0 inchangé (backward compat)
 *  - 200 avec filters → LeadOrder créé, filtersJson stocké, leadsCredited incrémenté
 *  - LeadOrder PAS créé pour source='welcome' (welcome n'a jamais de filters)
 *  - audit log inclut `has_filters: true|false`
 *
 * NB : les autres comportements (HMAC, idempotency, double-grant welcome,
 * contract_version) sont déjà testés dans credit-leads.test.ts (canonique).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const {
  requireHubHmacMock,
  resolveTenantByIdOrEmailMock,
  workspaceFindFirstMock,
  workspaceFindUniqueMock,
  transactionMock,
  leadCreditEventCreateMock,
  leadOrderCreateMock,
  workspaceUpdateMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireHubHmacMock: vi.fn(),
  resolveTenantByIdOrEmailMock: vi.fn(),
  workspaceFindFirstMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
  leadCreditEventCreateMock: vi.fn(),
  leadOrderCreateMock: vi.fn(),
  workspaceUpdateMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/hub/auth", () => ({ requireHubHmac: requireHubHmacMock }));
vi.mock("@/lib/hub/tenant-lookup", () => ({
  resolveTenantByIdOrEmail: resolveTenantByIdOrEmailMock,
}));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspace: {
      findFirst: workspaceFindFirstMock,
      findUnique: workspaceFindUniqueMock,
    },
    $transaction: transactionMock,
  },
}));

import { POST } from "@/app/api/tenants/[id]/credit-leads/route";
import { makeRequest, readJson } from "../../_helpers";

function ctxFor() {
  return {
    params: Promise.resolve({ id: "tenant-1" }),
  };
}

type TxClient = {
  leadCreditEvent: { create: typeof leadCreditEventCreateMock };
  leadOrder: { create: typeof leadOrderCreateMock };
  workspace: { update: typeof workspaceUpdateMock };
};

function setupTransaction() {
  transactionMock.mockImplementation(
    async (fn: (tx: TxClient) => Promise<unknown>) => {
      const tx: TxClient = {
        leadCreditEvent: { create: leadCreditEventCreateMock },
        leadOrder: { create: leadOrderCreateMock },
        workspace: { update: workspaceUpdateMock },
      };
      workspaceUpdateMock.mockResolvedValue({
        leadsCredited: 1500,
        leadsConsumed: 200,
      });
      return fn(tx);
    },
  );
}

describe("POST /api/tenants/[id]/credit-leads — v2.1 filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireHubHmacMock.mockImplementation(async () => ({
      ok: true,
      body: (globalThis as unknown as { __bodyRef: unknown }).__bodyRef,
      rawBody: "",
      mode: "standard",
    }));
    resolveTenantByIdOrEmailMock.mockResolvedValue({ id: "tenant-1" });
    workspaceFindFirstMock.mockResolvedValue({
      id: "ws-1",
      leadsCredited: 500,
      leadsConsumed: 200,
    });
    setupTransaction();
  });

  async function callPost(body: Record<string, unknown>) {
    (globalThis as unknown as { __bodyRef: unknown }).__bodyRef = body;
    return POST(
      makeRequest("/api/tenants/tenant-1/credit-leads", {
        method: "POST",
        body,
      }),
      ctxFor(),
    );
  }

  test("welcome with filters → 422 invalid_body (forbidden by superRefine)", async () => {
    const res = await callPost({
      quantity: 1000,
      source: "welcome",
      welcome_plan: "pro",
      idempotency_key: "11111111-1111-4111-8111-111111111111",
      contract_version: "2.1",
      filters: { country: "FR", regions: ["75"] },
    });
    expect(res.status).toBe(422);
    const json = (await readJson(res)) as { error: string };
    expect(json.error).toBe("invalid_body");
  });

  test("purchase WITHOUT filters → 200 backward compat (v2.0)", async () => {
    const res = await callPost({
      quantity: 1000,
      source: "purchase",
      idempotency_key: "22222222-2222-4222-8222-222222222222",
      stripe_payment_id: "pi_test_abc",
      contract_version: "2.0",
    });
    expect(res.status).toBe(200);
    // LeadOrder créé même sans filters (purchase →always tracked)
    expect(leadOrderCreateMock).toHaveBeenCalledTimes(1);
    // audit log mentionne has_filters=false
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ has_filters: false }),
      }),
    );
  });

  test("purchase WITH filters → 200, LeadOrder.filtersJson persisté, audit has_filters=true", async () => {
    const filters = {
      country: "FR",
      regions: ["75", "92"],
      sectors: ["restauration"],
      employee_range: { min: 1, max: 9 },
    };
    const res = await callPost({
      quantity: 1500,
      source: "purchase",
      idempotency_key: "33333333-3333-4333-8333-333333333333",
      stripe_payment_id: "pi_test_xyz",
      contract_version: "2.1",
      filters,
    });
    expect(res.status).toBe(200);
    expect(leadOrderCreateMock).toHaveBeenCalledTimes(1);

    const call = leadOrderCreateMock.mock.calls[0][0];
    expect(call.data.filtersJson).toEqual(filters);
    expect(call.data.quantity).toBe(1500);
    expect(call.data.source).toBe("purchase");
    expect(call.data.idempotencyKey).toBe(
      "33333333-3333-4333-8333-333333333333",
    );

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ has_filters: true }),
      }),
    );
  });

  test("welcome (no filters) → 200, NO LeadOrder created", async () => {
    const res = await callPost({
      quantity: 1900,
      source: "welcome",
      welcome_plan: "pro",
      idempotency_key: "44444444-4444-4444-8444-444444444444",
      contract_version: "2.0",
    });
    expect(res.status).toBe(200);
    expect(leadCreditEventCreateMock).toHaveBeenCalledTimes(1);
    // Welcome ne crée JAMAIS de LeadOrder (pas de config ICP).
    expect(leadOrderCreateMock).not.toHaveBeenCalled();
  });

  test("returns 422 on filters with unknown department", async () => {
    const res = await callPost({
      quantity: 100,
      source: "purchase",
      idempotency_key: "55555555-5555-4555-8555-555555555555",
      contract_version: "2.1",
      filters: { country: "FR", regions: ["999"] },
    });
    expect(res.status).toBe(422);
  });

  test("filters validation: country ≠ FR rejected", async () => {
    const res = await callPost({
      quantity: 100,
      source: "purchase",
      idempotency_key: "66666666-6666-4666-8666-666666666666",
      contract_version: "2.1",
      filters: { country: "BE" },
    });
    expect(res.status).toBe(422);
  });
});
