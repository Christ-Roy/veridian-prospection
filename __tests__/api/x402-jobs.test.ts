import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveVerifiedX402IdentityMock,
  createX402JobMock,
  listX402JobsMock,
  getX402JobMock,
  identity,
} = vi.hoisted(() => ({
  resolveVerifiedX402IdentityMock: vi.fn(),
  createX402JobMock: vi.fn(),
  listX402JobsMock: vi.fn(),
  getX402JobMock: vi.fn(),
  identity: {
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
  },
}));

vi.mock("@/lib/x402-orders", () => ({
  resolveVerifiedX402Identity: resolveVerifiedX402IdentityMock,
  createX402Job: createX402JobMock,
  listX402Jobs: listX402JobsMock,
  getX402Job: getX402JobMock,
}));

import { GET, POST } from "@/app/api/x402/jobs/route";
import { GET as GET_ONE } from "@/app/api/x402/jobs/[id]/route";
import { makeRequest, readJson } from "./_helpers";

const validBody = {
  clientIdempotencyKey: "carto-client-001",
  payload: {
    kind: "odh_cartography",
    filters: { all: [{ field: "departement", op: "eq", value: "69" }] },
    dimensions: ["departement"],
  },
};

describe("/api/x402/jobs routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveVerifiedX402IdentityMock.mockReturnValue({ ok: true, identity });
  });

  it("POST fail-closed sans identité x402 vérifiée", async () => {
    resolveVerifiedX402IdentityMock.mockReturnValue({
      ok: false,
      status: 401,
      error: "x402_identity_required",
    });

    const res = await POST(
      makeRequest("/api/x402/jobs", { method: "POST", body: validBody }),
    );

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: "x402_identity_required" });
    expect(createX402JobMock).not.toHaveBeenCalled();
  });

  it("POST délègue au service idempotent et propage le 202 queued", async () => {
    createX402JobMock.mockResolvedValue({
      ok: true,
      status: 202,
      data: { order: { id: "order-1", status: "queued" }, idempotentReplay: false },
    });

    const res = await POST(
      makeRequest("/api/x402/jobs", { method: "POST", body: validBody }),
    );

    expect(res.status).toBe(202);
    expect(createX402JobMock).toHaveBeenCalledWith(identity, validBody);
    expect(await readJson(res)).toEqual({
      order: { id: "order-1", status: "queued" },
      idempotentReplay: false,
    });
  });

  it("GET liste avec filtres query sans accepter de tenant depuis le client", async () => {
    listX402JobsMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { jobs: [], nextCursor: null },
    });

    const res = await GET(makeRequest("/api/x402/jobs?status=queued&limit=10"));

    expect(res.status).toBe(200);
    expect(listX402JobsMock).toHaveBeenCalledWith(identity, {
      status: "queued",
      limit: "10",
    });
  });

  it("GET /[id] propage le 404 scoping wallet du service", async () => {
    getX402JobMock.mockResolvedValue({
      ok: false,
      status: 404,
      error: "job_not_found",
    });

    const res = await GET_ONE(makeRequest("/api/x402/jobs/order-1"), {
      params: Promise.resolve({ id: "44444444-4444-4444-8444-444444444444" }),
    });

    expect(res.status).toBe(404);
    expect(getX402JobMock).toHaveBeenCalledWith(
      identity,
      "44444444-4444-4444-8444-444444444444",
    );
  });
});
