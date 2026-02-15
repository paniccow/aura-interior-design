import { supabase } from "../supabaseClient";

// Get Supabase auth token for API calls
export async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch (_e) { return null; }
}

// Build headers with optional auth token
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}
