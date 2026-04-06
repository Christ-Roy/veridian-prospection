// GET /api/entreprises/segments — liste des segments disponibles depuis la table segment_catalog.
//
// Response: { segments: [{ id, viewName, description, volume, createdAt }, ...] }

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type Row = {
  segment_id: string;
  view_name: string;
  description: string;
  volume: number | null;
  created_at: Date | null;
};

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT segment_id, view_name, description, volume, created_at
    FROM segment_catalog
    ORDER BY volume DESC NULLS LAST
  `;

  return NextResponse.json(
    {
      segments: rows.map((r) => ({
        id: r.segment_id,
        viewName: r.view_name,
        description: r.description,
        volume: r.volume ?? 0,
        createdAt: r.created_at,
      })),
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
