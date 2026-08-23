import { describe, expect, it, vi } from "vitest";
import {
  createX402Job,
  getX402Job,
  listX402Jobs,
  recordX402JobResult,
} from "@/lib/x402-orders/service";
import { sha256HexForJson } from "@/lib/x402-orders/json";
import type { VerifiedX402Identity } from "@/lib/x402-orders/identity";
import {
  MAX_X402_CARTOGRAPHY_ROWS,
  X402CreateJobRequestSchema,
} from "@/lib/x402-orders/payload";

const NOW = new Date("2026-08-23T10:00:00.000Z");

function identity(overrides: Partial<VerifiedX402Identity> = {}): VerifiedX402Identity {
  return {
    tenantId: null,
    workspaceId: null,
    userId: null,
    walletAccount: "eip155:8453:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    role: "member",
    payment: {
      identifier: "base8453:tx:0xabc123456789",
      asset: "USDC",
      network: "eip155:8453",
      authorizedAmountUnits: "250000",
      settledAmountUnits: "250000",
    },
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    clientIdempotencyKey: "carto-client-001",
    payload: {
      kind: "odh_cartography",
      filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
      dimensions: ["departement", "ecom_platform"],
      metrics: ["count", "with_email"],
      maxRows: 1000,
      resultFormat: "jsonl",
    },
    ...overrides,
  };
}

function rowFromData(data: Record<string, unknown>) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    ...data,
    createdAt: NOW,
    updatedAt: NOW,
    queuedAt: NOW,
    startedAt: null,
    completedAt: null,
    result: null,
    payment: null,
  };
}

function mockDb() {
  const db = {
    x402Buyer: {
      upsert: vi.fn().mockResolvedValue({ id: "buyer-1" }),
    },
    x402Order: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async (args: { data: Record<string, unknown> }) =>
        rowFromData(args.data),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    x402Payment: {
      create: vi.fn().mockResolvedValue({ id: "payment-1" }),
    },
    x402JobResult: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "result-1",
        ...args.data,
        createdAt: NOW,
      })),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return db;
}

describe("createX402Job", () => {
  it("refuse une cartographie qui depasse la borne de lignes", () => {
    const parsed = X402CreateJobRequestSchema.safeParse(
      validBody({
        payload: {
          ...validBody().payload,
          maxRows: MAX_X402_CARTOGRAPHY_ROWS + 1,
        },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("crée buyer/order/payment avec wallet injecté, rattachements nullable, payload hashé et montants entiers", async () => {
    const db = mockDb();
    const result = await createX402Job(identity(), validBody(), db as never, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(202);
    expect(result.data.idempotentReplay).toBe(false);
    expect(result.data.order.walletAccount).toBe(identity().walletAccount);
    expect(result.data.order.cost).toMatchObject({
      asset: "USDC",
      network: "eip155:8453",
      authorizedUnits: "250000",
      settledUnits: "250000",
    });
    expect(result.data.order.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    expect(db.x402Buyer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          walletAccount: identity().walletAccount,
        },
      }),
    );
    expect(db.x402Order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: null,
          workspaceId: null,
          userId: null,
          walletAccount: identity().walletAccount,
          paymentIdentifier: identity().payment.identifier,
          payloadHash: result.data.order.payloadHash,
          status: "queued",
        }),
      }),
    );
    expect(db.x402Payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentIdentifier: identity().payment.identifier,
          authorizedAmountUnits: BigInt("250000"),
          settledAmountUnits: BigInt("250000"),
          status: "settled",
        }),
      }),
    );
  });

  it("rejette un viewer avant toute écriture DB (RBAC)", async () => {
    const db = mockDb();
    const result = await createX402Job(
      identity({ role: "viewer" }),
      validBody(),
      db as never,
      NOW,
    );

    expect(result).toEqual({ ok: false, status: 403, error: "x402_forbidden" });
    expect(db.x402Order.create).not.toHaveBeenCalled();
  });

  it("rejoue idempotemment si paymentIdentifier + clientIdempotencyKey + payload hash matchent", async () => {
    const db = mockDb();
    const body = validBody();
    const existing = rowFromData({
      tenantId: identity().tenantId,
      workspaceId: identity().workspaceId,
      userId: identity().userId,
      walletAccount: identity().walletAccount,
      status: "queued",
      jobKind: "odh_cartography",
      clientIdempotencyKey: body.clientIdempotencyKey,
      paymentIdentifier: identity().payment.identifier,
      costAsset: "USDC",
      costNetwork: "eip155:8453",
      costAuthorizedUnits: BigInt("250000"),
      costSettledUnits: BigInt("250000"),
      payload: body.payload,
      payloadHash: sha256HexForJson(body.payload),
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    db.x402Order.findFirst.mockResolvedValue(existing);

    const result = await createX402Job(identity(), body, db as never, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.data.idempotentReplay).toBe(true);
    expect(db.x402Order.create).not.toHaveBeenCalled();
    expect(db.x402Payment.create).not.toHaveBeenCalled();
  });

  it("retourne 409 si une clé idempotente est rejouée avec un payload différent", async () => {
    const db = mockDb();
    db.x402Order.findFirst.mockResolvedValue(
      rowFromData({
        tenantId: identity().tenantId,
        walletAccount: identity().walletAccount,
        status: "queued",
        jobKind: "odh_cartography",
        clientIdempotencyKey: "carto-client-001",
        paymentIdentifier: identity().payment.identifier,
        costAsset: "USDC",
        costNetwork: "eip155:8453",
        costAuthorizedUnits: BigInt("250000"),
        costSettledUnits: BigInt("250000"),
        payloadHash: "0".repeat(64),
        expiresAt: new Date(NOW.getTime() + 60_000),
      }),
    );

    const result = await createX402Job(identity(), validBody(), db as never, NOW);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "idempotency_conflict",
    });
  });

  it("borne le payload ODH avec le schéma SearchFilters existant", async () => {
    const db = mockDb();
    const result = await createX402Job(
      identity(),
      validBody({
        payload: {
          kind: "odh_cartography",
          filters: {
            all: [{ field: "x; DROP TABLE entreprises", op: "eq", value: "69" }],
          },
          dimensions: ["departement"],
          maxRows: 1000,
        },
      }),
      db as never,
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(db.x402Order.create).not.toHaveBeenCalled();
  });
});

describe("listX402Jobs / getX402Job", () => {
  it("scope les listings member au wallet + status", async () => {
    const db = mockDb();
    const result = await listX402Jobs(
      identity({ role: "member" }),
      { status: "queued", limit: "20" },
      db as never,
    );

    expect(result.ok).toBe(true);
    expect(db.x402Order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          walletAccount: identity().walletAccount,
          status: "queued",
        },
      }),
    );
  });

  it("garde même admin scopé au wallet sur l'API publique", async () => {
    const db = mockDb();
    await listX402Jobs(
      identity({ role: "admin", walletAccount: "eip155:8453:0xadmin" }),
      { limit: "20" },
      db as never,
    );

    expect(db.x402Order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { walletAccount: "eip155:8453:0xadmin" },
      }),
    );
  });

  it("scope la lecture member au wallet", async () => {
    const db = mockDb();
    await getX402Job(
      identity({ role: "member" }),
      "44444444-4444-4444-8444-444444444444",
      db as never,
    );

    expect(db.x402Order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          walletAccount: identity().walletAccount,
          id: "44444444-4444-4444-8444-444444444444",
        },
      }),
    );
  });
});

describe("recordX402JobResult", () => {
  it("refuse un résultat inline et impose un pointeur objet externe", async () => {
    const db = mockDb();
    const result = await recordX402JobResult(
      {
        orderId: "44444444-4444-4444-8444-444444444444",
        tenantId: identity().tenantId,
        rawResultUri: "data:application/json;base64,e30=",
      },
      db as never,
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(db.x402JobResult.create).not.toHaveBeenCalled();
  });

  it("enregistre un pointeur R2 et marque le job succeeded sans blob lourd", async () => {
    const db = mockDb();
    const result = await recordX402JobResult(
      {
        orderId: "44444444-4444-4444-8444-444444444444",
        tenantId: identity().tenantId,
        rawResultUri: "r2://odh-cartographies/tenant/order/result.jsonl",
        rawResultSha256: "a".repeat(64),
        rowCount: 42,
        summary: { buckets: 3 },
      },
      db as never,
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(db.x402Order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "succeeded",
          completedAt: NOW,
        }),
      }),
    );
    expect(db.x402JobResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rawResultUri: "r2://odh-cartographies/tenant/order/result.jsonl",
        }),
      }),
    );
  });
});
