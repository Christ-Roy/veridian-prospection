import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveVerifiedX402Identity,
  X402_IDENTITY_HEADER,
  X402_IDENTITY_SECRET_ENV,
  X402_IDENTITY_SIGNATURE_HEADER,
} from "@/lib/x402-orders/identity";

const SECRET = "test-x402-identity-secret";

function signedRequest(payload: Record<string, unknown>, secret = SECRET): Request {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("hex");
  return new Request("https://prospection.test/api/x402/jobs", {
    headers: {
      [X402_IDENTITY_HEADER]: encoded,
      [X402_IDENTITY_SIGNATURE_HEADER]: signature,
    },
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    wallet_account: "eip155:8453:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    role: "member",
    payment: {
      identifier: "base8453:tx:0xabc123456789",
      asset: "USDC",
      network: "eip155:8453",
      authorized_amount_units: "250000",
      settled_amount_units: "250000",
    },
    issued_at: now - 5,
    expires_at: now + 60,
    ...overrides,
  };
}

describe("resolveVerifiedX402Identity", () => {
  const oldEnv = process.env[X402_IDENTITY_SECRET_ENV];

  beforeEach(() => {
    process.env[X402_IDENTITY_SECRET_ENV] = SECRET;
  });

  afterEach(() => {
    if (oldEnv === undefined) {
      delete process.env[X402_IDENTITY_SECRET_ENV];
    } else {
      process.env[X402_IDENTITY_SECRET_ENV] = oldEnv;
    }
  });

  it("fail-closed sans identité injectée", () => {
    const result = resolveVerifiedX402Identity(new Request("https://x.test"));
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "x402_identity_required",
    });
  });

  it("fail-closed si le secret interne n'est pas configuré", () => {
    delete process.env[X402_IDENTITY_SECRET_ENV];
    const result = resolveVerifiedX402Identity(signedRequest(validPayload()));
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "x402_identity_not_configured",
    });
  });

  it("rejette une signature HMAC invalide", () => {
    const result = resolveVerifiedX402Identity(
      signedRequest(validPayload(), "wrong-secret"),
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "x402_identity_invalid",
    });
  });

  it("résout wallet CAIP-10, rôle et montants entiers depuis le header signé sans tenant obligatoire", () => {
    const result = resolveVerifiedX402Identity(signedRequest(validPayload()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toMatchObject({
      tenantId: null,
      workspaceId: null,
      userId: null,
      walletAccount: "eip155:8453:0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      role: "member",
      payment: {
        identifier: "base8453:tx:0xabc123456789",
        authorizedAmountUnits: "250000",
        settledAmountUnits: "250000",
      },
    });
  });

  it("accepte un rattachement tenant/workspace/user optionnel après auth explicite", () => {
    const result = resolveVerifiedX402Identity(
      signedRequest(
        validPayload({
          tenant_id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          user_id: "33333333-3333-4333-8333-333333333333",
        }),
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity.tenantId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.identity.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(result.identity.userId).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("rejette un paiement incohérent settled > authorized", () => {
    const result = resolveVerifiedX402Identity(
      signedRequest(
        validPayload({
          payment: {
            identifier: "base8453:tx:0xabc123456789",
            asset: "USDC",
            network: "eip155:8453",
            authorized_amount_units: "100",
            settled_amount_units: "101",
          },
        }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "x402_identity_invalid_payload",
    });
  });
});
