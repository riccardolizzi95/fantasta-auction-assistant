import Link from "next/link";
import { signOut } from "@/app/actions";
import { getProfile } from "@/lib/supabase/server";
import LeagueTabs from "@/components/LeagueTabs";
import CreditiInNav from "@/components/CreditiInNav";

export default async function AppHeader({
  league,
}: {
  league?: { id: string; name: string; invite_code: string; status: string };
}) {
  const profile = await getProfile();

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur">
      {/* `min-w-0` sulle parti comprimibili e nessuna larghezza fissa: senza,
          il menu piu' il blocco utente sfondavano la finestra sotto i mille
          pixel e la pagina prendeva una barra di scorrimento orizzontale lunga
          quanto tutta l'asta. Il nome della lega si accorcia, le schede
          scorrono al loro interno, e i comandi a destra restano raggiungibili. */}
      <div className="mx-auto max-w-[1600px] px-4">
        <div className="flex h-14 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 font-bold tracking-tight">
            <span>⚽</span>
            <span className="hidden sm:inline">FantAsta</span>
          </Link>

          {league && (
            <>
              <span className="text-[var(--border-strong)]">/</span>
              <span className="min-w-0 truncate text-sm font-medium">{league.name}</span>
              <span className="chip num hidden xl:inline-flex" title="Codice per invitare gli altri">
                {league.invite_code}
              </span>
              <CreditiInNav />
            </>
          )}

          {/* Alla scrivania le schede stanno in riga con tutto il resto. Sul
              telefono no: sei voci piu' il nome della lega, i crediti e i
              comandi in trecentosettanta pixel non ci stanno, e quello che
              usciva era il blocco a destra. Sotto `lg` vanno su una riga loro,
              larga quanto lo schermo. */}
          {league ? (
            <div className="hidden min-w-0 lg:ml-auto lg:flex">
              <LeagueTabs leagueId={league.id} />
            </div>
          ) : (
            <span className="ml-auto" />
          )}

            <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-[var(--border)] pl-3 lg:ml-0">
            {profile?.is_admin && (
              <Link
                href="/admin"
                className="rounded-lg px-2 py-1.5 text-sm text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
              >
                Admin
              </Link>
            )}
            <span className="hidden text-xs text-[var(--text-faint)] sm:inline">
              {profile?.display_name}
            </span>
            <form action={signOut}>
              <button className="btn btn-sm" type="submit">
                Esci
              </button>
            </form>
            </div>
          </div>

        {league && (
          <div className="-mx-4 border-t border-[var(--border)] px-2 pb-1 lg:hidden">
            <LeagueTabs leagueId={league.id} />
          </div>
        )}
      </div>
    </header>
  );
}
