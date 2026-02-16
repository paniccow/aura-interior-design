import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ADMIN_PASS: string = process.env.ADMIN_PASSWORD || "aura2025admin";

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

const ALLOWED_ORIGINS: string[] = [
  "https://aurainteriordesign.org",
  "https://www.aurainteriordesign.org",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173"
];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const origin = (req.headers.origin || "") as string;
  const allowedOrigin = ALLOWED_ORIGINS.find(o => origin.startsWith(o)) || ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { email, adminPass } = (req.body || {}) as { email?: string; adminPass?: string };

  // Verify admin password
  if (adminPass !== ADMIN_PASS) {
    res.status(403).json({ error: "Invalid admin password" });
    return;
  }

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  if (!supabaseAdmin) {
    res.status(500).json({ error: "Supabase not configured" });
    return;
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
        res.status(404).json({ error: "No user found with email: " + email });
        return;
      }

      // Use first match
      const target = profiles[0];
      if (target.plan === "pro") {
        res.status(200).json({ message: target.email + " is already on Pro plan" });
        return;
      }

      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({ plan: "pro", updated_at: new Date().toISOString() })
        .eq("id", target.id);

      if (updateErr) {
        res.status(500).json({ error: "Failed to update: " + updateErr.message });
        return;
      }

      res.status(200).json({ message: target.email + " upgraded to Pro!" });
      return;
    }

    if (profile.plan === "pro") {
      res.status(200).json({ message: profile.email + " is already on Pro plan" });
      return;
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ plan: "pro", updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateErr) {
      res.status(500).json({ error: "Failed to update: " + updateErr.message });
      return;
    }

    res.status(200).json({ message: profile.email + " upgraded to Pro!" });
  } catch (err: unknown) {
    res.status(500).json({ error: "Server error: " + (err as Error).message });
  }
}
