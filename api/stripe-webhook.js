// Vercel Serverless Function — handles Stripe webhook events
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Disable Vercel body parsing so we get the raw body for signature verification
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        if (userId && session.subscription) {
          await supabaseAdmin.from("profiles").update({
            plan: "pro",
            stripe_subscription_id: session.subscription
          }).eq("id", userId);
          console.log("Upgraded user to pro:", userId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
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
          console.log("Subscription updated for:", profile.id, "→", isActive ? "pro" : "free");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
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
  } catch (err) {
    console.error("Webhook handler error:", err.message);
    // Still return 200 to acknowledge receipt — Stripe will retry otherwise
  }

  res.status(200).json({ received: true });
}
