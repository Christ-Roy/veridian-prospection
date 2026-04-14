import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/supabase/user-context';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const result = await requireUser();
  if ('error' in result) return result.error;
  const { ctx } = result;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { endpoint, keys, platform, userAgent } = body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  // Upsert by endpoint (one browser = one unique endpoint)
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      platform: platform || null,
      userAgent: userAgent || null,
    },
    update: {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      platform: platform || null,
      userAgent: userAgent || null,
    },
  });

  return NextResponse.json({ ok: true });
}
