import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ADMIN_PASS: string = process.env.ADMIN_PASSWORD || "aura2025admin";

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

interface ProfileRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  viz_count: number | null;
  viz_month: string | null;
  created_at: string;
  updated_at: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { adminPass } = (req.body || {}) as { adminPass?: string };
  if (adminPass !== ADMIN_PASS) { res.status(403).json({ error: "Unauthorized" }); return; }

  if (!supabaseAdmin) {
    res.status(200).json({
      totalUsers: 0, proUsers: 0, freeUsers: 0,
      totalVizCount: 0, recentUsers: [], userList: []
    });
    return;
  }

  try {
    // Get all profiles
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, plan, viz_count, viz_month, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }

    const allUsers: ProfileRow[] = (profiles || []) as ProfileRow[];
    const totalUsers: number = allUsers.length;
    const proUsers: number = allUsers.filter((u: ProfileRow) => u.plan === "pro").length;
    const freeUsers: number = totalUsers - proUsers;
    const totalVizCount: number = allUsers.reduce((sum: number, u: ProfileRow) => sum + (u.viz_count || 0), 0);

    // Recent signups (last 10)
    const recentUsers = allUsers.slice(0, 10).map((u: ProfileRow) => ({
      email: u.email,
      name: u.name,
      plan: u.plan,
      vizCount: u.viz_count || 0,
      createdAt: u.created_at
    }));

    // Full user list for the table
    const userList = allUsers.map((u: ProfileRow) => ({
      email: u.email,
      name: u.name,
      plan: u.plan,
      vizCount: u.viz_count || 0,
      vizMonth: u.viz_month,
      createdAt: u.created_at,
      updatedAt: u.updated_at
    }));

    res.status(200).json({
      totalUsers, proUsers, freeUsers,
      totalVizCount, recentUsers, userList
    });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
}
