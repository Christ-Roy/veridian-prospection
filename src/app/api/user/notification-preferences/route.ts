import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { requireUser } from "@/lib/supabase/user-context";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const prefs = await prisma.notificationPreferences.findUnique({
    where: { userId: ctx.userId },
  });

  if (!prefs) {
    return NextResponse.json({
      prefs: {
        reminderPush: true,
        reminderMinutesBefore: 30,
        dailyDigest: false,
      },
    });
  }

  return NextResponse.json({ prefs });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await req.json();
  const reminderPush = Boolean(body.reminderPush ?? true);
  const dailyDigest = Boolean(body.dailyDigest ?? false);
  let minutes = Number(body.reminderMinutesBefore);
  if (!Number.isFinite(minutes) || minutes < 1) minutes = 30;
  if (minutes > 1440) minutes = 1440;

  const prefs = await prisma.notificationPreferences.upsert({
    where: { userId: ctx.userId },
    create: {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      reminderPush,
      reminderMinutesBefore: minutes,
      dailyDigest,
    },
    update: {
      reminderPush,
      reminderMinutesBefore: minutes,
      dailyDigest,
    },
  });

  return NextResponse.json({ prefs });
}
