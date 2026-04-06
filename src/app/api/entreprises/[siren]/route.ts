// GET /api/entreprises/[siren] — fiche prospect complète par SIREN
//
// Returns all columns relevant for the dashboard profile page.
// No pagination, single row lookup via PK (< 1ms côté PG avec index).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const SIREN_RE = /^\d{9}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siren: string }> }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { siren } = await params;
  if (!SIREN_RE.test(siren)) {
    return NextResponse.json(
      { error: "Invalid SIREN (expected 9 digits)" },
      { status: 400 }
    );
  }

  const ent = await prisma.entreprise.findUnique({ where: { siren } });
  if (!ent) {
    return NextResponse.json({ error: "SIREN not found" }, { status: 404 });
  }

  // BigInt → number for JSON serialization
  const serialized = {
    ...ent,
    chiffreAffaires: ent.chiffreAffaires === null ? null : Number(ent.chiffreAffaires),
    resultatNet: ent.resultatNet === null ? null : Number(ent.resultatNet),
    montantMarchesPublics:
      ent.montantMarchesPublics === null ? null : Number(ent.montantMarchesPublics),
  };

  return NextResponse.json(serialized, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
