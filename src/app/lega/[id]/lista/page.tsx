import ListaRistretta from "@/components/ListaRistretta";
import { loadLeague } from "@/lib/leagueData";
import { createClient, getProfile } from "@/lib/supabase/server";
import { conConsigli } from "@/lib/livelli";

export const dynamic = "force-dynamic";

/**
 * La lista dei chiamabili, per tutta la lega.
 *
 * E' una pagina e non un pannello dentro l'asta perche' la guardano tutti e la
 * guardano **prima**: e' l'accordo su cosa si mette all'asta, e ognuno deve
 * poterlo leggere per conto suo senza chiedere niente a chi conduce.
 */
export default async function ListaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ league, participants, livello }, profile] = await Promise.all([
    loadLeague(id),
    getProfile(),
  ]);
  const puoScrivere = league.owner_id === profile?.id || !!profile?.is_admin;

  // A che punto e' l'asta: una lista si decide **prima**, e rifarla mentre si
  // compra vorrebbe dire cambiare le regole a meta' partita. Dopo la prima
  // chiamata registrata si puo' solo aggiungere qualcuno, uno per volta.
  const supabase = await createClient();
  const { count } = await supabase
    .from("auction_events")
    .select("id", { count: "exact", head: true })
    .eq("league_id", id);
  const astaIniziata = (count ?? 0) > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold tracking-tight">Lista dei chiamabili</h1>
      <p className="mb-5 max-w-3xl text-sm leading-relaxed text-[var(--text-faint)]">
        Con la chiamata casuale, su cinquecento nomi metà del pomeriggio se ne va su giocatori che
        nessuno vuole. Qui la lega decide chi può essere chiamato: il software poi lavora solo su
        questi — il piano, i prezzi, la scheda in asta e anche il microfono. Gli altri restano
        cercabili, ma non chiamabili.
      </p>
      <ListaRistretta
        leagueId={id}
        season={league.season}
        squadre={Math.max(participants.length, league.n_participants || 0, 1)}
        slots={league.slots}
        budget={league.budget}
        puoScrivere={puoScrivere}
        conConsigli={conConsigli(livello)}
        astaIniziata={astaIniziata}
      />
    </main>
  );
}
