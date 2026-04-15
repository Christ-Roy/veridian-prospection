import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireUser } from "@/lib/supabase/user-context";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * GET /api/appointments?from=ISO&to=ISO&siren=123
 * Liste les RDV du tenant (optionnellement filtres par fenetre ou prospect).
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const siren = searchParams.get("siren");

  const where: {
    tenantId: string;
    siren?: string;
    startAt?: { gte?: Date; lte?: Date };
  } = { tenantId: ctx.tenantId };

  if (siren) where.siren = siren;
  if (from || to) {
    where.startAt = {};
    if (from) where.startAt.gte = new Date(from);
    if (to) where.startAt.lte = new Date(to);
  }

  const appointments = await prisma.appointment.findMany({
    where,
    orderBy: { startAt: "asc" },
    take: 500,
  });

  return NextResponse.json({ appointments });
}

/**
 * POST /api/appointments
 * Body: { siren, startAt, endAt?, title, notes?, location?, sourceStage? }
 * Cree le RDV + genere l'URL Google Calendar preremplie.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const { siren, startAt, endAt, title, notes, location, sourceStage } = body;

  if (!siren || !startAt || !title) {
    return NextResponse.json(
      { error: "siren, startAt and title are required" },
      { status: 400 }
    );
  }

  const start = new Date(startAt);
  // Defaut: 30min si pas d'endAt fourni
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + 30 * 60 * 1000);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const googleEventUrl = buildGoogleCalendarUrl({
    title,
    startAt: start,
    endAt: end,
    details: notes || undefined,
    location: location || undefined,
  });

  const appointment = await prisma.appointment.create({
    data: {
      tenantId: ctx.tenantId,
      workspaceId: ctx.activeWorkspaceId,
      userId: ctx.userId,
      siren,
      startAt: start,
      endAt: end,
      title,
      location,
      notes,
      sourceStage,
      googleEventUrl,
    },
  });

  return NextResponse.json({ appointment });
}
