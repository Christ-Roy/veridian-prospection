import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

/**
 * POST /api/webhooks/stripe — handle Stripe subscription events.
 *
 * Events handled:
 * - checkout.session.completed → update tenant plan
 * - customer.subscription.deleted → downgrade to freemium
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_PREPROD || process.env.STRIPE_SECRET_KEY_TEST;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_TEST || "";

export async function POST(request: NextRequest) {
  if (!STRIPE_KEY || !WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const stripe = new Stripe(STRIPE_KEY);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`[stripe-webhook] Event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenant_id;
        const plan = session.metadata?.plan;

        if (tenantId && plan) {
          await updateTenantPlan(tenantId, plan);
          console.log(`[stripe-webhook] Tenant ${tenantId} upgraded to ${plan}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = sub.metadata?.tenant_id;
        if (tenantId) {
          await updateTenantPlan(tenantId, "freemium");
          console.log(`[stripe-webhook] Tenant ${tenantId} downgraded to freemium`);
        }
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe-webhook] Error processing ${event.type}:`, err);
  }

  return NextResponse.json({ received: true });
}

async function updateTenantPlan(tenantId: string, plan: string) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey);

  await admin
    .from("tenants")
    .update({ prospection_plan: plan })
    .eq("id", tenantId);
}
