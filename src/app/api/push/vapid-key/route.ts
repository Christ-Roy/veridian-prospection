import { NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/lib/web-push';

export const runtime = 'nodejs';

// Public — le browser a besoin de la clé VAPID avant le subscribe.
export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}
