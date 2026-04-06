import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import Stripe from "stripe";

/**
 * POST /api/checkout — create Stripe checkout session for plan upgrade.
 * Body: { plan: "geo" | "full" }
 * Returns: { url: string } (Stripe checkout URL)
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_PREPROD || process.env.STRIPE_SECRET_KEY_TEST;

// Price IDs — configure in Stripe dashboard, override via env vars
const PRICE_IDS: Record<string, string> = {
  geo: process.env.STRIPE_PRICE_GEO || "price_geo_placeholder",
  full: process.env.STRIPE_PRICE_FULL || "price_full_placeholder",
};

export async function POST(request: NextRequest) {
  if (!STRIPE_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const plan = body?.plan as string;

  if (!plan || !PRICE_IDS[plan]) {
    return NextResponse.json(
      { error: "Invalid plan. Use: geo, full", plans: Object.keys(PRICE_IDS) },
      { status: 400 }
    );
  }

  const tenantId = await getTenantId(auth.user.id);
  const stripe = new Stripe(STRIPE_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://prospection.app.veridian.site"}/admin/kpi?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://prospection.app.veridian.site"}/admin/kpi?checkout=cancelled`,
      metadata: {
        tenant_id: tenantId || "",
        user_id: auth.user.id,
        plan,
      },
      customer_email: auth.user.email,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] Stripe error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe checkout failed" },
      { status: 500 }
    );
  }
}
