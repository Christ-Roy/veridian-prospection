import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireUser } from "@/lib/supabase/user-context";
import { buildGoogleCalendarUrl } from "@/lib/google-calendar";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * PATCH /api/appointments/:id
 * Reschedule / update. Regenere l'URL Google si date/titre change.
 * Reset notifiedAt si on reschedule (pour que le cron renotifie).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const existing = await prisma.appointment.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const updates: {
    startAt?: Date;
    endAt?: Date;
    title?: string;
    notes?: string | null;
    location?: string | null;
    status?: string;
    googleEventUrl?: string;
    notifiedAt?: Date | null;
  } = {};

  if (body.startAt !== undefined) updates.startAt = new Date(body.startAt);
  if (body.endAt !== undefined) updates.endAt = new Date(body.endAt);
  if (body.title !== undefined) updates.title = body.title;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.location !== undefined) updates.location = body.location;
  if (body.status !== undefined) updates.status = body.status;

  const dateChanged =
    updates.startAt || updates.endAt || updates.title !== undefined;

  if (dateChanged) {
    const start = updates.startAt ?? existing.startAt;
    const end = updates.endAt ?? existing.endAt;
    const title = updates.title ?? existing.title;
    updates.googleEventUrl = buildGoogleCalendarUrl({
      title,
      startAt: start,
      endAt: end,
      details: (updates.notes ?? existing.notes) || undefined,
      location: (updates.location ?? existing.location) || undefined,
    });
    // Reset dedup pour qu'une nouvelle notif parte
    if (updates.startAt) updates.notifiedAt = null;
  }

  const appointment = await prisma.appointment.update({
    where: { id },
    data: updates,
  });

  return NextResponse.json({ appointment });
}

/**
 * DELETE /api/appointments/:id
 * Soft-cancel: status=cancelled. Pas de hard delete (historique).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;
  const { id } = await params;

  const existing = await prisma.appointment.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.appointment.update({
    where: { id },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ ok: true });
}
