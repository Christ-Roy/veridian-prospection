import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/errors — client-side error reporting endpoint.
 *
 * Receives errors captured by ClientErrorBoundary (window.onerror +
 * unhandledrejection) and persists them to `client_errors` with hour-bucket
 * dedupe (cf ticket 2026-05-23-persist-client-errors-db.md).
 *
 * Best-effort : if the DB write fails, the response is still 204 — we never
 * want a logging endpoint to surface errors to the ClientErrorBoundary
 * (which would just re-POST them, hello loop). Rate limit (10/min/IP) is
 * the first line of defense, the dedupe upsert is the second.
 */

const MAX_MESSAGE = 1000;
const MAX_STACK = 2000;
const MAX_URL = 2000;
const MAX_USER_AGENT = 200;

const recentErrors = new Map<string, number>();

type IncomingPayload = {
  message?: unknown;
  stack?: unknown;
  url?: unknown;
  userAgent?: unknown;
  context?: { filename?: unknown; lineno?: unknown } | unknown;
};

function asString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function computeDedupeKey(
  message: string,
  filename: string | null,
  lineno: number | null,
): string {
  return createHash("sha1")
    .update(`${message}|${filename ?? ""}|${lineno ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export function bucketToHour(d: Date): Date {
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    0,
    0,
    0,
  ));
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const key = `${ip}-${minuteBucket}`;
  const count = recentErrors.get(key) ?? 0;
  if (count >= 10) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  recentErrors.set(key, count + 1);
  for (const [k] of recentErrors) {
    if (!k.endsWith(`-${minuteBucket}`)) recentErrors.delete(k);
  }

  let body: IncomingPayload;
  try {
    body = (await request.json()) as IncomingPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const message = asString(body.message, MAX_MESSAGE);
  if (!message) {
    return NextResponse.json({ ok: false, reason: "missing_message" }, { status: 400 });
  }
  const stack = asString(body.stack, MAX_STACK);
  const url = asString(body.url, MAX_URL);
  const userAgent = asString(body.userAgent, MAX_USER_AGENT);

  let filename: string | null = null;
  let lineno: number | null = null;
  if (body.context && typeof body.context === "object") {
    const ctx = body.context as { filename?: unknown; lineno?: unknown };
    filename = asString(ctx.filename, 500);
    if (typeof ctx.lineno === "number" && Number.isFinite(ctx.lineno)) {
      lineno = Math.trunc(ctx.lineno);
    }
  }

  const dedupeKey = computeDedupeKey(message, filename, lineno);
  const occurredAt = new Date(now);
  const occurredHour = bucketToHour(occurredAt);

  try {
    await prisma.clientError.upsert({
      where: {
        dedupeKey_occurredHour: { dedupeKey, occurredHour },
      },
      create: {
        message,
        stack,
        url,
        userAgent,
        dedupeKey,
        occurredHour,
        occurredAt,
        lastSeenAt: occurredAt,
        count: 1,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: occurredAt,
      },
    });
  } catch (err) {
    // Best-effort : never surface DB issues to the client boundary.
    console.error("[api/errors] persist failed", err);
  }

  return new NextResponse(null, { status: 204 });
}
