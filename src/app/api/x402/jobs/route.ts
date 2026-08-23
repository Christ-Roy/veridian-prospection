import { NextRequest, NextResponse } from "next/server";
import {
  createX402Job,
  listX402Jobs,
  resolveVerifiedX402Identity,
  type X402ServiceResult,
} from "@/lib/x402-orders";

export const dynamic = "force-dynamic";

function errorResponse(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { error, ...(details ? { details } : {}) },
    { status },
  );
}

function serviceResponse<T>(result: X402ServiceResult<T>) {
  if (!result.ok) {
    return errorResponse(result.status, result.error, result.details);
  }
  return NextResponse.json(result.data, { status: result.status });
}

export async function POST(request: NextRequest) {
  const identity = resolveVerifiedX402Identity(request);
  if (!identity.ok) {
    return errorResponse(identity.status, identity.error);
  }

  const body = await request.json().catch(() => ({}));
  const result = await createX402Job(identity.identity, body);
  return serviceResponse(result);
}

export async function GET(request: NextRequest) {
  const identity = resolveVerifiedX402Identity(request);
  if (!identity.ok) {
    return errorResponse(identity.status, identity.error);
  }

  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const result = await listX402Jobs(identity.identity, query);
  return serviceResponse(result);
}
