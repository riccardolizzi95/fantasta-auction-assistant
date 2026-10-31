import ListoneView from "@/components/ListoneView";
import { loadLeague } from "@/lib/leagueData";
import { getProfile } from "@/lib/supabase/server";
import { conConsigli } from "@/lib/livelli";

export const dynamic = "force-dynamic";

export default async function ListonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ league, livello }, profile] = await Promise.all([loadLeague(id), getProfile()]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold tracking-tight">Listone {league.season}</h1>
      <p className="mb-5 text-sm text-[var(--text-faint)]">
        {conConsigli(livello)
          ? "Il valore in verde è quello calcolato dal modello per la tua lega: se è più alto del listino, il mercato lo sottovaluta."
          : "Tutti i giocatori della stagione, con la quotazione ufficiale e chi è già stato assegnato."}
      </p>
      <ListoneView isAdmin={!!profile?.is_admin} />
    </main>
  );
}
