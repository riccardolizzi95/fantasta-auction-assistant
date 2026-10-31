import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Il ponte con FantaAstaLive non ha una sessione, e non puo' averne una.
 *
 * Gira dentro la pagina del tabellone, su un altro dominio: il cookie di
 * sessione non parte, per costruzione. Si presenta con il segreto della lega, e
 * a verificarlo e' la route — che non fa nient'altro finche' quel segreto non
 * torna. Farlo passare di qui e' l'unico modo perche' arrivi fin li'.
 */
const SENZA_SESSIONE = /^\/api\/lega\/[^/]+\/fantaastalive\/live$/;

export async function proxy(request: NextRequest) {
  if (SENZA_SESSIONE.test(request.nextUrl.pathname)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  // Le route API rispondono da sole con un 401 in JSON: mandarle su /login
  // farebbe arrivare al fetch una pagina HTML, e il messaggio d'errore che
  // vedrebbe l'utente sarebbe incomprensibile.
  if (!user && path.startsWith("/api/")) {
    return NextResponse.json({ error: "Sessione scaduta: rientra e riprova." }, { status: 401 });
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
