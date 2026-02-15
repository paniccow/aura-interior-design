import { createClient } from "@supabase/supabase-js";

const ADMIN_PASS = "aura2025admin";

const supabaseAdmin =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { adminPass } = req.body || {};
  if (adminPass !== ADMIN_PASS) return res.status(403).json({ error: "Unauthorized" });

  if (!supabaseAdmin) {
    return res.status(200).json({
      totalUsers: 0, proUsers: 0, freeUsers: 0,
      totalVizCount: 0, recentUsers: [], userList: []
    });
  }

  try {
    // Get all profiles
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, plan, viz_count, viz_month, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const allUsers = profiles || [];
    const totalUsers = allUsers.length;
    const proUsers = allUsers.filter(u => u.plan === "pro").length;
    const freeUsers = totalUsers - proUsers;
    const totalVizCount = allUsers.reduce((sum, u) => sum + (u.viz_count || 0), 0);

    // Recent signups (last 10)
    const recentUsers = allUsers.slice(0, 10).map(u => ({
      email: u.email,
      name: u.name,
      plan: u.plan,
      vizCount: u.viz_count || 0,
      createdAt: u.created_at
    }));

    // Full user list for the table
    const userList = allUsers.map(u => ({
      email: u.email,
      name: u.name,
      plan: u.plan,
      vizCount: u.viz_count || 0,
      vizMonth: u.viz_month,
      createdAt: u.created_at,
      updatedAt: u.updated_at
    }));

    return res.status(200).json({
      totalUsers, proUsers, freeUsers,
      totalVizCount, recentUsers, userList
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
