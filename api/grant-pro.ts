import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ADMIN_PASS: string | undefined = process.env.ADMIN_PASSWORD;

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// Simple rate limiter — 5 attempts per minute per IP
const rateLimitMap = new Map<string, { windowStart: number; count: number }>();
function checkAdminRateLimit(req: VercelRequest): boolean {
  const forwarded = req.headers["x-forwarded-for"];
  const key = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 60000) { rateLimitMap.set(key, { windowStart: now, count: 1 }); return true; }
  entry.count++;
  return entry.count <= 5;
}

const ALLOWED_ORIGINS: string[] = [
  "https://aurainteriordesign.org",
  "https://www.aurainteriordesign.org",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173"
];

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const origin = (req.headers.origin || "") as string;
  const allowedOrigin = ALLOWED_ORIGINS.find(o => origin === o);
  if (!allowedOrigin) { res.status(403).json({ error: "Origin not allowed" }); return; }
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { email, adminPass } = (req.body || {}) as { email?: string; adminPass?: string };

  if (!checkAdminRateLimit(req)) { res.status(429).json({ error: "Too many requests" }); return; }

  // Verify admin password
  if (!ADMIN_PASS || adminPass !== ADMIN_PASS) {
    res.status(403).json({ error: "Unauthorized" });
    return;
  }

  if (!email || typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Valid email is required" });
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
        res.status(404).json({ error: "No user found with that email" });
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
        res.status(500).json({ error: "Failed to update user" });
        return;
      }

      res.status(200).json({ message: "User upgraded to Pro!" });
      return;
    }

    if (profile.plan === "pro") {
      res.status(200).json({ message: "User is already on Pro plan" });
      return;
    }

    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ plan: "pro", updated_at: new Date().toISOString() })
      .eq("id", profile.id);

    if (updateErr) {
      res.status(500).json({ error: "Failed to update user" });
      return;
    }

    res.status(200).json({ message: "User upgraded to Pro!" });
  } catch (err: unknown) {
    res.status(500).json({ error: "Internal server error" });
  }
}
