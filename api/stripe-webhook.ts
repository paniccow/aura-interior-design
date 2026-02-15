// Vercel Serverless Function — handles Stripe webhook events
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Disable Vercel body parsing so we get the raw body for signature verification
export const config = { api: { bodyParser: false } };

async function buffer(readable: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") { res.status(405).end(); return; }

  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    console.error("Webhook signature verification failed:", (err as Error).message);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        if (userId && session.subscription) {
          await supabaseAdmin.from("profiles").update({
            plan: "pro",
            stripe_subscription_id: session.subscription as string
          }).eq("id", userId);
          console.log("Upgraded user to pro:", userId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        if (profile) {
          const isActive = ["active", "trialing"].includes(subscription.status);
          await supabaseAdmin.from("profiles").update({
            plan: isActive ? "pro" : "free",
            stripe_subscription_id: subscription.id
          }).eq("id", profile.id);
          console.log("Subscription updated for:", profile.id, "->", isActive ? "pro" : "free");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();
        if (profile) {
          await supabaseAdmin.from("profiles").update({
            plan: "free",
            stripe_subscription_id: null
          }).eq("id", profile.id);
          console.log("Subscription cancelled for:", profile.id);
        }
        break;
      }
    }
  } catch (err: unknown) {
    console.error("Webhook handler error:", (err as Error).message);
    // Still return 200 to acknowledge receipt — Stripe will retry otherwise
  }

  res.status(200).json({ received: true });
}
