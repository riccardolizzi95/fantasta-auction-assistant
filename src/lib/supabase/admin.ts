import { createClient } from "@supabase/supabase-js";

/**
 * Client con service role: bypassa la RLS. Da usare SOLO in route handler server-side
 * (import del listone, creazione account). Non deve mai finire nel bundle client.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY non configurata: impostala nelle variabili d'ambiente.",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
