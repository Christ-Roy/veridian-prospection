import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/supabase/user-context';
import { sendPushNotification } from '@/lib/web-push';

export const runtime = 'nodejs';

/**
 * POST /api/push/send — Broadcast push notification to all subscriptions of the user's tenant.
 * Protected by Supabase auth.
 */
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

  const { title, body: notifBody, url, tag } = body;
  if (!title || !notifBody) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 });
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { tenantId: ctx.tenantId },
  });

  if (subscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, cleaned: 0 });
  }

  let sent = 0;
  let failed = 0;
  const goneIds: number[] = [];

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const result = await sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        { title, body: notifBody, url, tag },
      );
      return { id: sub.id, result };
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.result.ok) {
        sent++;
      } else {
        failed++;
        if (r.value.result.gone) {
          goneIds.push(r.value.id);
        }
      }
    } else {
      failed++;
    }
  }

  // Cleanup expired endpoints
  if (goneIds.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { id: { in: goneIds } },
    });
  }

  return NextResponse.json({ ok: true, sent, failed, cleaned: goneIds.length });
}
