import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // We finish email-confirm on /auth/callback ourselves. Auto-detect
        // here races the callback, holds the auth Web Lock, and then sign-in
        // on /login waits forever.
        detectSessionInUrl: false,
        storageKey: "uraan-auth",
      },
    });
  }
  return browserClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
