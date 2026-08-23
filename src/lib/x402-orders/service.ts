import { prisma } from "@/lib/prisma";
import { canPerform, type WorkspaceRole } from "@/lib/auth/roles";
import { sha256HexForJson, canonicalJson } from "./json";
import {
  MAX_X402_PAYLOAD_CANONICAL_BYTES,
  X402CreateJobRequestSchema,
  X402JobIdSchema,
  X402ListJobsQuerySchema,
  X402ResultSchema,
  type X402JobStatus,
} from "./payload";
import type { VerifiedX402Identity } from "./identity";

type X402OrderRow = Record<string, unknown> & {
  id: string;
  tenantId?: string | null;
  walletAccount: string;
  status: string;
  clientIdempotencyKey: string;
  paymentIdentifier: string;
  payloadHash: string;
  payload?: unknown;
  result?: X402ResultRow | null;
  payment?: Record<string, unknown> | null;
};

type X402ResultRow = Record<string, unknown> & {
  rawResultUri?: string | null;
  rawResultSha256?: string | null;
  rowCount?: number | null;
  summary?: unknown;
};

type X402Db = {
  x402Buyer: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  x402Order: {
    findFirst(args: unknown): Promise<X402OrderRow | null>;
    findMany(args: unknown): Promise<X402OrderRow[]>;
    create(args: unknown): Promise<X402OrderRow>;
    update(args: unknown): Promise<X402OrderRow>;
  };
  x402Payment: {
    create(args: unknown): Promise<unknown>;
  };
  x402JobResult: {
    create(args: unknown): Promise<X402ResultRow>;
  };
  $transaction<T>(fn: (tx: X402Db) => Promise<T>): Promise<T>;
};

export type X402ServiceResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; details?: unknown };

export type X402OrderView = {
  id: string;
  tenantId: string | null;
  workspaceId: string | null;
  userId: string | null;
  walletAccount: string;
  status: X402JobStatus;
  jobKind: string;
  clientIdempotencyKey: string;
  paymentIdentifier: string;
  payloadHash: string;
  payload?: unknown;
  cost: {
    asset: string;
    network: string;
    authorizedUnits: string;
    settledUnits: string;
  };
  result: {
    rawResultUri: string;
    rawResultSha256: string | null;
    rowCount: number | null;
    summary: unknown;
  } | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const defaultDb = prisma as unknown as X402Db;

function canCreateJobs(role: WorkspaceRole): boolean {
  return canPerform(role, "resource.create");
}

function asString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Math.trunc(value).toString();
  if (typeof value === "string") return value;
  return "0";
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function serializeOrder(row: X402OrderRow, includePayload: boolean): X402OrderView {
  const result = row.result ?? null;
  return {
    id: String(row.id),
    tenantId: (row.tenantId as string | null | undefined) ?? null,
    workspaceId: (row.workspaceId as string | null | undefined) ?? null,
    userId: (row.userId as string | null | undefined) ?? null,
    walletAccount: String(row.walletAccount),
    status: String(row.status) as X402JobStatus,
    jobKind: String(row.jobKind ?? "odh_cartography"),
    clientIdempotencyKey: String(row.clientIdempotencyKey),
    paymentIdentifier: String(row.paymentIdentifier),
    payloadHash: String(row.payloadHash),
    ...(includePayload ? { payload: row.payload } : {}),
    cost: {
      asset: String(row.costAsset ?? ""),
      network: String(row.costNetwork ?? ""),
      authorizedUnits: asString(row.costAuthorizedUnits),
      settledUnits: asString(row.costSettledUnits),
    },
    result: result?.rawResultUri
      ? {
          rawResultUri: String(result.rawResultUri),
          rawResultSha256: result.rawResultSha256 ? String(result.rawResultSha256) : null,
          rowCount: typeof result.rowCount === "number" ? result.rowCount : null,
          summary: result.summary ?? null,
        }
      : null,
    queuedAt: iso(row.queuedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    errorCode: (row.errorCode as string | null | undefined) ?? null,
    errorMessage: (row.errorMessage as string | null | undefined) ?? null,
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

function scopedOrderWhere(identity: VerifiedX402Identity, extra: Record<string, unknown> = {}) {
  return {
    walletAccount: identity.walletAccount,
    ...extra,
  };
}

function replayMatches(
  row: X402OrderRow,
  identity: VerifiedX402Identity,
  clientIdempotencyKey: string,
  payloadHash: string,
): boolean {
  return (
    row.walletAccount === identity.walletAccount &&
    row.clientIdempotencyKey === clientIdempotencyKey &&
    row.paymentIdentifier === identity.payment.identifier &&
    row.payloadHash === payloadHash &&
    asString(row.costAuthorizedUnits) === identity.payment.authorizedAmountUnits &&
    asString(row.costSettledUnits) === identity.payment.settledAmountUnits
  );
}

async function findReplayCandidate(
  db: X402Db,
  identity: VerifiedX402Identity,
  clientIdempotencyKey: string,
) {
  return db.x402Order.findFirst({
    where: {
      OR: [
        { walletAccount: identity.walletAccount, clientIdempotencyKey },
        { paymentIdentifier: identity.payment.identifier },
      ],
    },
    include: { result: true, payment: true },
  });
}

export async function createX402Job(
  identity: VerifiedX402Identity,
  body: unknown,
  db: X402Db = defaultDb,
  now: Date = new Date(),
): Promise<
  X402ServiceResult<{ order: X402OrderView; idempotentReplay: boolean }>
> {
  if (!canCreateJobs(identity.role)) {
    return { ok: false, status: 403, error: "x402_forbidden" };
  }

  const parsed = X402CreateJobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      error: "invalid_body",
      details: parsed.error.issues,
    };
  }

  let payloadHash: string;
  try {
    const canonical = canonicalJson(parsed.data.payload);
    if (Buffer.byteLength(canonical, "utf8") > MAX_X402_PAYLOAD_CANONICAL_BYTES) {
      return { ok: false, status: 422, error: "payload_too_large" };
    }
    payloadHash = sha256HexForJson(parsed.data.payload);
  } catch {
    return { ok: false, status: 422, error: "invalid_payload_json" };
  }

  const existing = await findReplayCandidate(
    db,
    identity,
    parsed.data.clientIdempotencyKey,
  );
  if (existing) {
    if (
      !replayMatches(
        existing,
        identity,
        parsed.data.clientIdempotencyKey,
        payloadHash,
      )
    ) {
      return { ok: false, status: 409, error: "idempotency_conflict" };
    }

    return {
      ok: true,
      status: 200,
      data: {
        order: serializeOrder(existing, true),
        idempotentReplay: true,
      },
    };
  }

  const expiresAt = new Date(now.getTime() + parsed.data.expiresInSeconds * 1000);
  const authorized = BigInt(identity.payment.authorizedAmountUnits);
  const settled = BigInt(identity.payment.settledAmountUnits);
  const paymentStatus = settled > BigInt(0) ? "settled" : "authorized";

  try {
    const order = await db.$transaction(async (tx) => {
      const buyer = await tx.x402Buyer.upsert({
        where: {
          walletAccount: identity.walletAccount,
        },
        update: {
          lastSeenAt: now,
          ...(identity.tenantId ? { tenantId: identity.tenantId } : {}),
          ...(identity.workspaceId ? { workspaceId: identity.workspaceId } : {}),
        },
        create: {
          tenantId: identity.tenantId,
          workspaceId: identity.workspaceId,
          walletAccount: identity.walletAccount,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        select: { id: true },
      });

      const created = await tx.x402Order.create({
        data: {
          buyerId: buyer.id,
          tenantId: identity.tenantId,
          workspaceId: identity.workspaceId,
          userId: identity.userId,
          walletAccount: identity.walletAccount,
          jobKind: parsed.data.payload.kind,
          status: "queued",
          clientIdempotencyKey: parsed.data.clientIdempotencyKey,
          paymentIdentifier: identity.payment.identifier,
          costAsset: identity.payment.asset,
          costNetwork: identity.payment.network,
          costAuthorizedUnits: authorized,
          costSettledUnits: settled,
          payload: parsed.data.payload,
          payloadHash,
          queuedAt: now,
          expiresAt,
        },
        include: { result: true, payment: true },
      });

      await tx.x402Payment.create({
        data: {
          orderId: created.id,
          tenantId: identity.tenantId,
          walletAccount: identity.walletAccount,
          paymentIdentifier: identity.payment.identifier,
          asset: identity.payment.asset,
          network: identity.payment.network,
          authorizedAmountUnits: authorized,
          settledAmountUnits: settled,
          status: paymentStatus,
          rawPayment: identity.payment.raw,
        },
      });

      return created;
    });

    return {
      ok: true,
      status: 202,
      data: {
        order: serializeOrder(order, true),
        idempotentReplay: false,
      },
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const replay = await findReplayCandidate(
        db,
        identity,
        parsed.data.clientIdempotencyKey,
      );
      if (
        replay &&
        replayMatches(
          replay,
          identity,
          parsed.data.clientIdempotencyKey,
          payloadHash,
        )
      ) {
        return {
          ok: true,
          status: 200,
          data: {
            order: serializeOrder(replay, true),
            idempotentReplay: true,
          },
        };
      }
      return { ok: false, status: 409, error: "idempotency_conflict" };
    }
    throw err;
  }
}

export async function listX402Jobs(
  identity: VerifiedX402Identity,
  rawQuery: unknown,
  db: X402Db = defaultDb,
): Promise<X402ServiceResult<{ jobs: X402OrderView[]; nextCursor: string | null }>> {
  const parsed = X402ListJobsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      error: "invalid_query",
      details: parsed.error.issues,
    };
  }

  const rows = await db.x402Order.findMany({
    where: scopedOrderWhere(identity, parsed.data.status ? { status: parsed.data.status } : {}),
    orderBy: { createdAt: "desc" },
    take: parsed.data.limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
    include: { result: true, payment: true },
  });

  const hasMore = rows.length > parsed.data.limit;
  const page = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  return {
    ok: true,
    status: 200,
    data: {
      jobs: page.map((row) => serializeOrder(row, false)),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    },
  };
}

export async function getX402Job(
  identity: VerifiedX402Identity,
  jobId: unknown,
  db: X402Db = defaultDb,
): Promise<X402ServiceResult<{ job: X402OrderView }>> {
  const parsedId = X402JobIdSchema.safeParse(jobId);
  if (!parsedId.success) {
    return { ok: false, status: 400, error: "invalid_job_id" };
  }

  const row = await db.x402Order.findFirst({
    where: scopedOrderWhere(identity, { id: parsedId.data }),
    include: { result: true, payment: true },
  });

  if (!row) {
    return { ok: false, status: 404, error: "job_not_found" };
  }

  return {
    ok: true,
    status: 200,
    data: { job: serializeOrder(row, true) },
  };
}

export async function recordX402JobResult(
  args: {
    orderId: string;
    tenantId?: string | null;
    rawResultUri: string;
    rawResultSha256?: string;
    rowCount?: number;
    summary?: Record<string, unknown>;
  },
  db: X402Db = defaultDb,
  now: Date = new Date(),
): Promise<X402ServiceResult<{ result: X402ResultRow }>> {
  const parsed = X402ResultSchema.safeParse({
    rawResultUri: args.rawResultUri,
    rawResultSha256: args.rawResultSha256,
    rowCount: args.rowCount,
    summary: args.summary,
  });
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      error: "invalid_result",
      details: parsed.error.issues,
    };
  }

  const result = await db.$transaction(async (tx) => {
    await tx.x402Order.update({
      where: { id: args.orderId, ...(args.tenantId ? { tenantId: args.tenantId } : {}) },
      data: {
        status: "succeeded",
        completedAt: now,
      },
    });
    return tx.x402JobResult.create({
      data: {
        orderId: args.orderId,
        tenantId: args.tenantId ?? null,
        rawResultUri: parsed.data.rawResultUri,
        rawResultSha256: parsed.data.rawResultSha256,
        rowCount: parsed.data.rowCount,
        summary: parsed.data.summary,
      },
    });
  });

  return { ok: true, status: 200, data: { result } };
}
