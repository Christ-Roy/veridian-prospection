import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import pkg from "../../../../package.json";

/**
 * Health check standard Veridian SaaS (voir docs/saas-standards.md §8).
 *
 * Format de réponse :
 *   {
 *     status: "ok" | "degraded" | "down",
 *     version: string,
 *     db: "ok" | "ko",
 *     dependencies: Record<string, "ok" | "ko" | "skipped">,
 *     timestamp: string (ISO8601),
 *     // extras Prospection (rétro-compat)
 *     leadCount?: number,
 *   }
 *
 * HTTP code :
 *   - 200 si status === "ok" ou "degraded"
 *   - 503 si status === "down"
 */

const TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function GET() {
  const dependencies: Record<string, "ok" | "ko" | "skipped"> = {};

  // --- DB check (bloquant pour le status) ---
  let db: "ok" | "ko" = "ko";
  let leadCount: number | undefined = undefined;

  try {
    const dbResult = await withTimeout(
      prisma.$queryRaw<[{ ok: number }]>`SELECT 1 as ok`,
      TIMEOUT_MS,
    );
    if (dbResult && dbResult[0]?.ok === 1) {
      db = "ok";
      // Extra Prospection : nombre d'entreprises (best-effort, non bloquant)
      try {
        const count = await withTimeout(
          prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM entreprises`,
          TIMEOUT_MS,
        );
        if (count) leadCount = Number(count[0]?.count ?? 0);
      } catch {
        /* table may not exist on fresh DB */
      }
    }
  } catch {
    db = "ko";
  }

  // --- Status global ---
  let status: "ok" | "degraded" | "down" = "ok";
  if (db === "ko") {
    status = "down";
  } else if (Object.values(dependencies).some((v) => v === "ko")) {
    status = "degraded";
  }

  const body = {
    status,
    version: pkg.version ?? "unknown",
    db,
    dependencies,
    timestamp: new Date().toISOString(),
    ...(leadCount !== undefined ? { leadCount } : {}),
  };

  return NextResponse.json(body, { status: status === "down" ? 503 : 200 });
}
