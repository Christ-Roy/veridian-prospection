import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeRole, type WorkspaceRole } from "@/lib/auth/roles";

export const X402_IDENTITY_HEADER = "x-veridian-x402-identity";
export const X402_IDENTITY_SIGNATURE_HEADER = "x-veridian-x402-signature";
export const X402_IDENTITY_SECRET_ENV = "X402_INTERNAL_IDENTITY_SECRET";

const DECIMAL_UNITS = z.string().regex(/^(0|[1-9][0-9]{0,38})$/);
const CAIP10_ACCOUNT = z
  .string()
  .min(5)
  .max(192)
  .regex(/^[a-z0-9]+:[A-Za-z0-9.-]+:.+$/);

const VerifiedIdentityHeaderSchema = z
  .object({
    tenant_id: z.string().uuid().nullable().optional(),
    workspace_id: z.string().uuid().nullable().optional(),
    user_id: z.string().uuid().nullable().optional(),
    wallet_account: CAIP10_ACCOUNT,
    role: z.enum(["owner", "admin", "member", "viewer"]).default("member"),
    payment: z
      .object({
        identifier: z.string().min(8).max(192),
        asset: z.string().min(1).max(64),
        network: z.string().min(1).max(64),
        authorized_amount_units: DECIMAL_UNITS,
        settled_amount_units: DECIMAL_UNITS.default("0"),
        raw: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    issued_at: z.number().int().positive(),
    expires_at: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const authorized = BigInt(value.payment.authorized_amount_units);
    const settled = BigInt(value.payment.settled_amount_units);
    if (settled > authorized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "settled_amount_units cannot exceed authorized_amount_units",
      });
    }
  });

export type VerifiedX402Identity = {
  tenantId: string | null;
  workspaceId: string | null;
  userId: string | null;
  walletAccount: string;
  role: WorkspaceRole;
  payment: {
    identifier: string;
    asset: string;
    network: string;
    authorizedAmountUnits: string;
    settledAmountUnits: string;
    raw?: Record<string, unknown>;
  };
};

export type X402IdentityResolution =
  | { ok: true; identity: VerifiedX402Identity }
  | { ok: false; status: number; error: string };

function hmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeBase64UrlJson(payload: string): unknown {
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(json);
}

export function resolveVerifiedX402Identity(request: Request): X402IdentityResolution {
  const payloadHeader = request.headers.get(X402_IDENTITY_HEADER);
  const signature = request.headers.get(X402_IDENTITY_SIGNATURE_HEADER);
  if (!payloadHeader || !signature) {
    return { ok: false, status: 401, error: "x402_identity_required" };
  }

  const secret = process.env[X402_IDENTITY_SECRET_ENV];
  if (!secret) {
    return { ok: false, status: 503, error: "x402_identity_not_configured" };
  }

  const expected = hmacHex(payloadHeader, secret);
  if (!safeEqualHex(signature, expected)) {
    return { ok: false, status: 403, error: "x402_identity_invalid" };
  }

  let decoded: unknown;
  try {
    decoded = decodeBase64UrlJson(payloadHeader);
  } catch {
    return { ok: false, status: 403, error: "x402_identity_malformed" };
  }

  const parsed = VerifiedIdentityHeaderSchema.safeParse(decoded);
  if (!parsed.success) {
    return { ok: false, status: 403, error: "x402_identity_invalid_payload" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (parsed.data.expires_at <= now) {
    return { ok: false, status: 401, error: "x402_identity_expired" };
  }
  if (parsed.data.issued_at > now + 60) {
    return { ok: false, status: 403, error: "x402_identity_not_yet_valid" };
  }

  return {
    ok: true,
      identity: {
      tenantId: parsed.data.tenant_id ?? null,
      workspaceId: parsed.data.workspace_id ?? null,
      userId: parsed.data.user_id ?? null,
      walletAccount: parsed.data.wallet_account,
      role: normalizeRole(parsed.data.role),
      payment: {
        identifier: parsed.data.payment.identifier,
        asset: parsed.data.payment.asset,
        network: parsed.data.payment.network,
        authorizedAmountUnits: parsed.data.payment.authorized_amount_units,
        settledAmountUnits: parsed.data.payment.settled_amount_units,
        raw: parsed.data.payment.raw,
      },
    },
  };
}
