import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Test DB connection + get lead count
    const result = await prisma.$queryRaw<[{ ok: number }]>`SELECT 1 as ok`;
    const dbOk = result[0]?.ok === 1;

    let leadCount = 0;
    try {
      const count = await prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM entreprises`;
      leadCount = Number(count[0]?.count ?? 0);
    } catch { /* table may not exist on fresh DB */ }

    return NextResponse.json({
      status: dbOk ? "healthy" : "degraded",
      db: dbOk ? "connected" : "unreachable",
      leadCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        db: "error",
        error: error instanceof Error ? error.message : "unknown",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
