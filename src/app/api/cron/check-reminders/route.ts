import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPushNotification } from '@/lib/web-push';

export const runtime = 'nodejs';

type ReminderRow = {
  siren: string;
  tenant_id: string;
  pipeline_stage: string;
  deadline: string;
  denomination: string | null;
  dirigeant_nom: string | null;
};

/**
 * GET /api/cron/check-reminders — Called by Dokploy Schedule Job every 5 min.
 *
 * Finds outreach records in stages a_rappeler or site_demo with deadline
 * in the next 15 minutes, and sends push notifications to all subscriptions
 * of the tenant.
 *
 * Protected by CRON_SECRET to prevent abuse.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const inFifteenMin = new Date(now.getTime() + 15 * 60 * 1000);

  const rows = await prisma.$queryRawUnsafe<ReminderRow[]>(`
    SELECT o.siren, o.tenant_id, o.pipeline_stage, o.deadline::text,
           e.denomination, e.dirigeant_nom
    FROM outreach o
    JOIN entreprises e ON e.siren = o.siren
    WHERE o.pipeline_stage IN ('a_rappeler', 'site_demo')
      AND o.deadline IS NOT NULL
      AND o.deadline >= $1
      AND o.deadline <= $2
  `, now.toISOString(), inFifteenMin.toISOString());

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, reminders: 0, sent: 0 });
  }

  let totalSent = 0;
  const goneIds: number[] = [];

  // Group by tenant to batch notifications
  const byTenant = new Map<string, ReminderRow[]>();
  for (const row of rows) {
    const list = byTenant.get(row.tenant_id) || [];
    list.push(row);
    byTenant.set(row.tenant_id, list);
  }

  for (const [tenantId, reminders] of byTenant) {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { tenantId },
    });

    if (subscriptions.length === 0) continue;

    for (const reminder of reminders) {
      const entreprise = reminder.denomination || reminder.siren;
      const isRappel = reminder.pipeline_stage === 'a_rappeler';
      const deadlineDate = new Date(reminder.deadline);
      const timeStr = deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      const title = isRappel
        ? `Rappel : ${entreprise}`
        : `Demo planifiee : ${entreprise}`;
      const body = isRappel
        ? `Rappeler ${reminder.dirigeant_nom || entreprise} a ${timeStr}`
        : `Demo prevue a ${timeStr}${reminder.dirigeant_nom ? ` avec ${reminder.dirigeant_nom}` : ''}`;

      const results = await Promise.allSettled(
        subscriptions.map(async (sub) => {
          const result = await sendPushNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            {
              title,
              body,
              url: `/prospects?siren=${reminder.siren}`,
              tag: `reminder-${reminder.siren}-${reminder.deadline}`,
            },
          );
          return { id: sub.id, result };
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.result.ok) totalSent++;
          if (r.value.result.gone) goneIds.push(r.value.id);
        }
      }
    }
  }

  // Cleanup expired endpoints
  if (goneIds.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { id: { in: goneIds } },
    });
  }

  return NextResponse.json({
    ok: true,
    reminders: rows.length,
    sent: totalSent,
    cleaned: goneIds.length,
  });
}
