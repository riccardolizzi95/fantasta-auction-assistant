import AppHeader from "@/components/AppHeader";
import LeagueDataProvider from "@/components/LeagueDataProvider";
import { loadLeague } from "@/lib/leagueData";

/**
 * Intestazione e dati della lega vivono qui, non nelle singole pagine.
 *
 * Next conserva il layout quando si passa da una scheda all'altra dello stesso
 * segmento: cosi' listone e statistiche vengono scaricati una volta sola, e
 * spostarsi fra Asta, Rose e Listone e' immediato invece di ricominciare da capo
 * ogni volta.
 */
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { league, participants, me, activeStrategy, isOwner, livello } = await loadLeague(id);

  return (
    <>
      <LeagueDataProvider
        league={league}
        participants={participants}
        me={me}
        activeStrategy={activeStrategy}
        isOwner={isOwner}
        livello={livello}
      >
        {/* L'intestazione sta dentro il provider perche' ci mostra i crediti
            residui: erano un pannello intero nella colonna di sinistra, e in
            un'asta lo spazio verticale e' la risorsa scarsa. */}
        <AppHeader league={league} />
        {children}
      </LeagueDataProvider>
    </>
  );
}
