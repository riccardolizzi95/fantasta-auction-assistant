import StrategyPicker from "@/components/StrategyPicker";
import QuotaGiocatore from "@/components/QuotaGiocatore";
import ScalaPrezzi from "@/components/ScalaPrezzi";
import { Empty, Panel } from "@/components/ui";
import { loadLeague } from "@/lib/leagueData";
import { conConsigli } from "@/lib/livelli";
import { getStrategy, normalizeSplit, QUOTA_GIOCATORE_DEFAULT } from "@/lib/fanta/strategies";
import { scalaPrezzi } from "@/lib/fanta/piano";

export const dynamic = "force-dynamic";

/**
 * La strategia ha una pagina sua.
 *
 * Stava dentro le impostazioni, fra le regole della lega e gli account: due
 * cose che si toccano una volta e poi mai piu'. La strategia invece si cambia
 * **durante** l'asta, ed e' la cosa che si guarda quando il piano non regge —
 * non un'impostazione, una decisione.
 */
export default async function StrategiaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, me, activeStrategy, livello } = await loadLeague(id);

  // La scala che il software deriverebbe da solo: e' il punto di partenza del
  // campo avanzato, cosi' non si scrive su un foglio bianco.
  const def = getStrategy(activeStrategy?.key ?? "equilibrata");
  const slotsTotali = { ...league.slots };
  const derivata = scalaPrezzi({
    split: normalizeSplit(
      (activeStrategy?.budget_split as never) ?? def?.budgetSplit ?? { P: 0.07, D: 0.16, C: 0.33, A: 0.44 },
    ),
    slotsLiberi: slotsTotali,
    spesoPerRuolo: { P: 0, D: 0, C: 0, A: 0 },
    topTargets: def?.topTargets ?? { P: 1, D: 1, C: 2, A: 1 },
    budgetTotale: me?.budget_total ?? league.budget,
    tettoMax: Math.round(
      (activeStrategy?.max_quota_giocatore ?? QUOTA_GIOCATORE_DEFAULT) *
        (me?.budget_total ?? league.budget),
    ),
  });

  if (!conConsigli(livello)) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-1 text-xl font-bold tracking-tight">Strategia</h1>
        <Panel title="Serve il premium" subtitle="La strategia decide come il software ti consiglia i prezzi.">
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            Con un account base l&apos;asta la segui e la registri, e la rosa la pianifichi a mano
            dal riquadro <strong>Modifica</strong> in pagina Asta. Scegliere una strategia — e farsi
            dire come ripartire i crediti — è la parte premium.
          </p>
        </Panel>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">La tua strategia</h1>
        <p className="mt-0.5 text-sm text-[var(--text-faint)]">
          Personale e privata: ogni partecipante ha la sua e gli altri non la vedono, nemmeno chi ha
          creato la lega. Si può cambiare a metà asta.
        </p>
      </div>

      <Panel title="Come ripartire i crediti">
        {me ? (
          <StrategyPicker
            leagueId={id}
            participantId={me.id}
            budget={me.budget_total}
            rules={league.rules}
            activeKey={activeStrategy?.key ?? null}
            activeSplit={activeStrategy?.budget_split ?? null}
          />
        ) : (
          <Empty>Devi essere un partecipante per impostare una strategia.</Empty>
        )}
      </Panel>

      {me && (
        <Panel
          title="Quanto spendere sul 1°, sul 2°, sul 3°"
          subtitle="Impostazione avanzata: la forma della rosa, reparto per reparto. Vince su tutto il resto."
        >
          <ScalaPrezzi
            leagueId={id}
            participantId={me.id}
            budget={me.budget_total}
            derivata={derivata}
            aMano={(activeStrategy?.price_ladder as Record<string, number[]>) ?? null}
            attiva={!!activeStrategy}
          />
        </Panel>
      )}

      {me && (
        <Panel
          title="Quanto può pesare un giocatore solo"
          subtitle="Il freno che impedisce al piano di mettere mezzo budget su un nome e riempire il resto a un credito."
        >
          <QuotaGiocatore
            leagueId={id}
            participantId={me.id}
            budget={me.budget_total}
            quota={activeStrategy?.max_quota_giocatore ?? null}
            attiva={!!activeStrategy}
          />
        </Panel>
      )}
    </main>
  );
}
