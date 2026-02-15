import { supabase } from "../supabaseClient.js";

// Get Supabase auth token for API calls
export async function getAuthToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch { return null; }
}

// Build headers with optional auth token
export async function authHeaders() {
  const token = await getAuthToken();
  const h = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}
