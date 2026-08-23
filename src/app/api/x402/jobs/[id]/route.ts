import { NextRequest, NextResponse } from "next/server";
import {
  getX402Job,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = resolveVerifiedX402Identity(request);
  if (!identity.ok) {
    return errorResponse(identity.status, identity.error);
  }

  const { id } = await params;
  const result = await getX402Job(identity.identity, id);
  return serviceResponse(result);
}
