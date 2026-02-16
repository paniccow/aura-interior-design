import { supabase } from "../supabaseClient";

// Get Supabase auth token for API calls
// Uses getSession() which automatically handles token refresh
export async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("Auth token error:", error.message);
      return null;
    }
    return session?.access_token || null;
  } catch (err) {
    console.error("Auth token fetch failed:", err);
    return null;
  }
}

// Build headers with optional auth token
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}
