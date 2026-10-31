import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildValuations, type Valuation, type ValuationResult } from "./valuation";
import type {
  AbsenceRow,
  CareerRow,
  LeagueRow,
  ParticipantRow,
  PlayerIdentity,
  PlayerRow,
  PlayerWithStats,
  StatusRow,
} from "./types";

type StatsRow = PlayerWithStats["stats"];

/**
 * Il listone e le valutazioni, calcolate dove devono stare.
 *
 * Prima il browser scaricava le statistiche e chiamava `buildValuations` da
 * solo. Funzionava, ma metteva il modello — la parte che distingue questo
 * software da un foglio di calcolo — dentro il portatile di chi apre la pagina,
 * e rendeva il livello dell'utenza una tenda invece che un muro: nascondere i
 * prezzi nell'interfaccia non serve a niente se i prezzi sono comunque nella
 * memoria della scheda.
 *
 * Adesso il conto si fa qui e viaggia gia' fatto. A chi non ha il premium le
 * valutazioni non vengono proprio calcolate: non c'e' niente da filtrare in
 * uscita, perche' non esistono.
 *
 * Le statistiche invece continuano ad arrivare a tutti, ed e' voluto: lo storico
 * di un giocatore e' un fatto, e la scheda lo mostra a chiunque. Chi volesse
 * potrebbe rifarsi il proprio modello a partire da li' — ma quello e' scrivere
 * il software, non usarlo di nascosto.
 */
/**
 * `ValuationResult` senza le mappe, che non attraversano JSON.
 *
 * `byRole` non viaggia: e' `byPlayer` raggruppato e ordinato, e il client lo
 * ricostruisce con `rankInRole` invece di ricevere ogni valutazione due volte.
 */
export type ValutazioniSerializzate = {
  /** Ogni valutazione porta gia' il suo `playerId`: la mappa si ricostruisce di li'. */
  perGiocatore: Valuation[];
  replacementFM: ValuationResult["replacementFM"];
  replacementMV: ValuationResult["replacementMV"];
  matchdaysPlayed: number;
  benchDepth: number;
  anchoredOnRealPrices: boolean;
  pricePerVOR: number;
  totalMarketValue: number;
};

const SELECT_PLAYERS =
  "id, season, external_id, name, team, role, role_mantra, quotation_initial, quotation_current, fvm, is_active," +
  " player_stats(season, competition, club, source, source_detail, rating, matches, minutes, avg_vote, avg_fantavote," +
  " goals, assists, own_goals, yellow_cards, red_cards, pen_scored, pen_missed, pen_saved," +
  " goals_conceded, clean_sheets)";

/** Il listone della stagione, con tutto lo storico attaccato. */
export async function caricaListone(season: string): Promise<PlayerWithStats[]> {
  const supabase = await createClient();
  const all: PlayerWithStats[] = [];
  const pageSize = 1000;
  // PostgREST restituisce mille righe per volta e non lo dice: senza paginare,
  // seicento giocatori diventano cinquecento e nessuno se ne accorge.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("players")
      .select(SELECT_PLAYERS)
      .eq("season", season)
      .eq("is_active", true)
      .order("name")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []).map((row) => {
      const raw = row as unknown as Record<string, unknown> & { player_stats: StatsRow[] };
      const { player_stats, ...rest } = raw;
      const history = (player_stats ?? [])
        .filter(Boolean)
        .slice()
        .sort((a, b) => (a!.season < b!.season ? 1 : -1)) as NonNullable<StatsRow>[];
      return {
        ...(rest as unknown as PlayerRow),
        stats: history[0] ?? null,
        history,
      } as PlayerWithStats;
    });
    all.push(...batch);
    if (batch.length < pageSize) break;
  }

  // Identita', carriera, assenze e stato fisico riguardano una minoranza di
  // giocatori: quattro query a parte pesano molto meno che allargare la prima a
  // tutti e cinquecento.
  const [identities, career, absences, status] = await Promise.all([
    supabase.from("player_identities").select("*"),
    supabase.from("player_career").select("*").order("season", { ascending: false }),
    supabase.from("player_absences").select("*"),
    supabase.from("player_status").select("*"),
  ]);
  const perId = new Map((identities.data ?? []).map((i) => [i.player_id, i as PlayerIdentity]));
  const perCareer = new Map<string, CareerRow[]>();
  for (const c of (career.data ?? []) as CareerRow[]) {
    perCareer.set(c.player_id, [...(perCareer.get(c.player_id) ?? []), c]);
  }
  const perStato = new Map(((status.data ?? []) as StatusRow[]).map((x) => [x.player_id, x]));
  const perAssenze = new Map<string, AbsenceRow[]>();
  for (const a of (absences.data ?? []) as AbsenceRow[]) {
    perAssenze.set(a.player_id, [...(perAssenze.get(a.player_id) ?? []), a]);
  }
  for (const p of all) {
    p.identity = perId.get(p.id) ?? null;
    p.career = perCareer.get(p.id) ?? [];
    p.absences = perAssenze.get(p.id) ?? [];
    p.status = perStato.get(p.id) ?? null;
  }
  return all;
}

/**
 * Le valutazioni per questa lega, pronte da mandare.
 *
 * I crediti in gioco sono quelli davvero assegnati alle squadre: se qualcuno
 * gioca con un budget diverso, i prezzi di equilibrio cambiano per tutti. Per
 * questo dipende dai partecipanti e non solo dalla lega, ed e' anche il motivo
 * per cui il client deve richiederle di nuovo quando una squadra cambia.
 */
export function valutaListone(
  players: PlayerWithStats[],
  league: LeagueRow,
  participants: ParticipantRow[],
): ValutazioniSerializzate {
  const v = valutaListoneCompleto(players, league, participants);
  return {
    perGiocatore: [...v.byPlayer.values()],
    replacementFM: v.replacementFM,
    replacementMV: v.replacementMV,
    matchdaysPlayed: v.matchdaysPlayed,
    benchDepth: v.benchDepth,
    anchoredOnRealPrices: v.anchoredOnRealPrices,
    pricePerVOR: v.pricePerVOR,
    totalMarketValue: v.totalMarketValue,
  };
}

/**
 * Le stesse valutazioni, ma intere.
 *
 * Verso il browser viaggia la forma serializzata — una mappa non passa da JSON —
 * ma chi sta sul server e deve dare in pasto le valutazioni al motore ha bisogno
 * dell'oggetto vero, `byRole` compreso. Ricostruirlo a mano dal serializzato
 * sembrava piu' rapido: mancava un campo, e il mercato tornava vuoto.
 */
export function valutaListoneCompleto(
  players: PlayerWithStats[],
  league: LeagueRow,
  participants: ParticipantRow[],
) {
  const nParticipants = Math.max(participants.length, league.n_participants);
  const avgBudget =
    participants.length > 0
      ? participants.reduce((a, p) => a + p.budget_total, 0) / participants.length
      : league.budget;

  const v = buildValuations(players, {
    season: league.season,
    nParticipants,
    budget: Math.round(avgBudget),
    slots: league.slots,
    rules: league.rules,
    // I prezzi veri di un'asta passata, se la lega ne ha: il listino descrive un
    // prezziario, questi descrivono come si comporta questa lega quando c'e' da
    // alzare la mano.
    topPrices: league.top_prices ?? undefined,
  });

  return v;
}
