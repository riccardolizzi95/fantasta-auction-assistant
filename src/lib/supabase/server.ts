import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chiamato da un Server Component: il refresh del token lo fa il middleware.
          }
        },
      },
    },
  );
}

/**
 * Utente e profilo della richiesta corrente, letti una volta sola.
 *
 * Fra proxy, layout, header e caricamento della lega, `getUser()` finiva per
 * essere chiamato quattro o cinque volte per pagina, ognuna con un giro di rete
 * verso il server di autenticazione. `cache` di React li fonde in uno solo per
 * richiesta.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, is_admin, is_premium")
    .eq("id", user.id)
    .single();
  return data;
});
