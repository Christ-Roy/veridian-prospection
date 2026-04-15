import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPushNotification } from '@/lib/web-push';

export const runtime = 'nodejs';

type LegacyReminderRow = {
  siren: string;
  tenant_id: string;
  pipeline_stage: string;
  deadline: string;
  denomination: string | null;
  dirigeant_nom: string | null;
};

const DEFAULT_MINUTES_BEFORE = 30;
// Fenetre de scan: +/- 2.5 min autour du point cible pour ne pas rater un slot
// avec le cron toutes les 5 min.
const WINDOW_HALF_MIN = 2.5;

/**
 * GET /api/cron/check-reminders — Called by Dokploy Schedule Job every 5 min.
 *
 * Scan deux sources:
 *  1. appointments (source de verite) — respecte notified_at et prefs user
 *  2. outreach.deadline legacy (transition) — pour les RDV crees avant la migration
 *
 * Envoie les notifs push aux users qui ont reminder_push=true et a l'horizon
 * defini par reminder_minutes_before (defaut 30). Dedup via notified_at.
 *
 * Protege par CRON_SECRET.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  let totalSent = 0;
  let totalNotified = 0;
  const goneIds: number[] = [];

  // ==========================================================================
  // 1) APPOINTMENTS — source de verite
  // ==========================================================================

  // Charger toutes les prefs d'un coup (petite table, une ligne par user)
  const allPrefs = await prisma.notificationPreferences.findMany();
  const prefsByUser = new Map(allPrefs.map((p) => [p.userId, p]));

  // Pour scanner efficacement, on prend une fenetre large (jusqu'a 60min)
  // et on filtre en code selon la pref de chaque user.
  const maxHorizonMin = Math.max(
    DEFAULT_MINUTES_BEFORE,
    ...allPrefs.map((p) => p.reminderMinutesBefore),
  );
  const scanUpper = new Date(now.getTime() + (maxHorizonMin + WINDOW_HALF_MIN) * 60_000);

  const pendingAppointments = await prisma.appointment.findMany({
    where: {
      status: 'scheduled',
      notifiedAt: null,
      startAt: { gte: now, lte: scanUpper },
    },
  });

  for (const appt of pendingAppointments) {
    // Recupere les subscriptions du tenant, filtrees par les users qui
    // ont accepte le reminder_push ET dont le delai souhaite englobe le RDV.
    const subs = await prisma.pushSubscription.findMany({
      where: { tenantId: appt.tenantId },
    });
    if (subs.length === 0) continue;

    const eligibleSubs = subs.filter((sub) => {
      const pref = prefsByUser.get(sub.userId);
      const enabled = pref?.reminderPush ?? true;
      if (!enabled) return false;
      const minutes = pref?.reminderMinutesBefore ?? DEFAULT_MINUTES_BEFORE;
      const target = new Date(appt.startAt.getTime() - minutes * 60_000);
      const delta = Math.abs(target.getTime() - now.getTime());
      return delta <= WINDOW_HALF_MIN * 60_000;
    });

    if (eligibleSubs.length === 0) continue;

    const timeStr = appt.startAt.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const body = `${appt.title} — ${timeStr}`;

    const results = await Promise.allSettled(
      eligibleSubs.map(async (sub) => {
        const result = await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          {
            title: appt.title,
            body,
            url: `/prospects?siren=${appt.siren}`,
            tag: `appt-${appt.id}`,
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

    // Marque le RDV comme notifie (dedup)
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { notifiedAt: now },
    });
    totalNotified++;
  }

  // ==========================================================================
  // 2) LEGACY outreach.deadline — fallback transition
  // ==========================================================================
  // On garde le scan 15 min pour les RDV qui n'ont pas d'Appointment (compat).
  // Evite les doublons avec appointments via NOT EXISTS.

  const legacyUpper = new Date(now.getTime() + 15 * 60_000);

  const legacyRows = await prisma.$queryRawUnsafe<LegacyReminderRow[]>(`
    SELECT o.siren, o.tenant_id, o.pipeline_stage, o.deadline::text,
           e.denomination, e.dirigeant_nom
    FROM outreach o
    JOIN entreprises e ON e.siren = o.siren
    WHERE o.pipeline_stage IN ('a_rappeler', 'site_demo')
      AND o.deadline IS NOT NULL
      AND o.deadline >= $1
      AND o.deadline <= $2
      AND NOT EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.siren = o.siren
          AND a.tenant_id = o.tenant_id
          AND a.start_at = o.deadline
      )
  `, now.toISOString(), legacyUpper.toISOString());

  if (legacyRows.length > 0) {
    const byTenant = new Map<string, LegacyReminderRow[]>();
    for (const row of legacyRows) {
      const list = byTenant.get(row.tenant_id) || [];
      list.push(row);
      byTenant.set(row.tenant_id, list);
    }

    for (const [tenantId, reminders] of byTenant) {
      const subs = await prisma.pushSubscription.findMany({
        where: { tenantId },
      });
      if (subs.length === 0) continue;

      const eligibleSubs = subs.filter((sub) => {
        const pref = prefsByUser.get(sub.userId);
        return pref?.reminderPush ?? true;
      });
      if (eligibleSubs.length === 0) continue;

      for (const reminder of reminders) {
        const entreprise = reminder.denomination || reminder.siren;
        const isRappel = reminder.pipeline_stage === 'a_rappeler';
        const deadlineDate = new Date(reminder.deadline);
        const timeStr = deadlineDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        const title = isRappel ? `Rappel : ${entreprise}` : `Demo planifiee : ${entreprise}`;
        const body = isRappel
          ? `Rappeler ${reminder.dirigeant_nom || entreprise} a ${timeStr}`
          : `Demo prevue a ${timeStr}${reminder.dirigeant_nom ? ` avec ${reminder.dirigeant_nom}` : ''}`;

        const results = await Promise.allSettled(
          eligibleSubs.map(async (sub) => {
            const result = await sendPushNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              {
                title,
                body,
                url: `/prospects?siren=${reminder.siren}`,
                tag: `legacy-${reminder.siren}-${reminder.deadline}`,
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
  }

  // Cleanup expired endpoints
  if (goneIds.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { id: { in: goneIds } },
    });
  }

  return NextResponse.json({
    ok: true,
    appointments: totalNotified,
    legacy: legacyRows.length,
    sent: totalSent,
    cleaned: goneIds.length,
  });
}
