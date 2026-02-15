import { createClient } from "@supabase/supabase-js";

const ADMIN_PASS = "aura2025admin";

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, adminPass } = req.body || {};

  // Verify admin password
  if (adminPass !== ADMIN_PASS) {
    return res.status(403).json({ error: "Invalid admin password" });
  }

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  try {
    // Find user by email in profiles table
    const { data: profile, error: findErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, plan")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (findErr || !profile) {
      // Try case-insensitive search
      const { data: profiles, error: searchErr } = await supabaseAdmin
        .from("profiles")
        .select("id, email, plan")
        .ilike("email", email.trim());

      if (searchErr || !profiles || profiles.length === 0) {
        return res.status(404).json({ error: "No user found with email: " + email });
      }

      // Use first match
      const target = profiles[0];
      if (target.plan === "pro") {
        return res.status(200).json({ message: target.email + " is already on Pro plan" });
      }

      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({ plan: "pro", updated_at: new Date().toISOString() })
        .eq("id", target.id);

      if (updateErr) {
        return res.status(500).json({ error: "Failed to update: " + updateErr.message });
      }

      return res.status(200).json({ message: target.email + " upgraded to Pro!" });
    }

    if (profile.plan === "pro") {
      return res.status(200).json({ message: profile.email + " is already on Pro plan" });
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ plan: "pro", updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateErr) {
      return res.status(500).json({ error: "Failed to update: " + updateErr.message });
    }

    return res.status(200).json({ message: profile.email + " upgraded to Pro!" });
  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
