"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { buildMarketState, type MarketState } from "@/lib/fanta/market";
import { REVIEW_VUOTA, reviewStrategies, type StrategyReview } from "@/lib/fanta/review";
import { type Valuation, type ValuationResult } from "@/lib/fanta/valuation";
import type { ValutazioniSerializzate } from "@/lib/fanta/datiLega";
import { conConsigli, type Livello } from "@/lib/livelli";
import { eUnAzzeramento } from "@/lib/fanta/movimenti";
import {
  ROLES,
  type AbsenceRow,
  type AuctionEventRow,
  type Puntata,
  type Rimozione,
  type Spostamento,
  type CareerRow,
  type LeagueRow,
  type ParticipantRow,
  type PlayerIdentity,
  type PlayerRow,
  type PlayerWithStats,
  type RoleMap,
  type StatusRow,
} from "@/lib/fanta/types";

export type RosterPin = { id: string; player_id: string; price: number };

export type ActiveStrategy = {
  id: string;
  key: string;
  label: string;
  budget_split: Record<string, number>;
  version: number;
  rationale: string | null;
  /** Quota massima del budget su un giocatore solo. `null` = lo decide il software. */
  max_quota_giocatore: number | null;
  /** La scala dei prezzi scritta a mano, reparto per reparto. */
  price_ladder: Record<string, number[]> | null;
} | null;

type Ctx = {
  loading: boolean;
  error: string | null;
  league: LeagueRow;
  players: PlayerWithStats[];
  playerMap: Map<string, PlayerRow>;
  valuations: ValuationResult;
  events: AuctionEventRow[];
  /** I rilanci sentiti su chi e' in asta adesso, dal primo all'ultimo. */
  puntate: Puntata[];
  /**
   * Gli acquisti annullati, in coda ai movimenti.
   *
   * Un acquisto cancellato — perche' era sbagliato, o perche' di la' l'hanno
   * tolto dalla rosa — sparisce dagli eventi, e con lui spariva ogni traccia
   * che fosse mai esistito. Ma durante un'asta "quel giocatore era di
   * Bianchi e non lo e' piu'" e' un'informazione, non rumore: resta qui,
   * finche' la pagina e' aperta.
   */
  rimozioni: Rimozione[];
  /**
   * Gli acquisti passati di rosa, o corretti nella cifra.
   *
   * Non e' un acquisto nuovo e non e' una cancellazione: e' la stessa riga che
   * cambia padrone, e finche' non si vedeva i crediti di due squadre si
   * muovevano senza spiegazione.
   */
  spostamenti: Spostamento[];
  participants: ParticipantRow[];
  me: ParticipantRow | null;
  /** Chi ha creato la lega: e' l'unico che puo' rettificare gli acquisti altrui. */
  isOwner: boolean;
  /** Base, premium o amministratore. `conConsigli(livello)` e' la domanda vera. */
  livello: Livello;
  activeStrategy: ActiveStrategy;
  state: MarketState;
  review: StrategyReview;
  recordEvent: (input: {
    playerId: string;
    participantId: string | null;
    price: number;
    outcome: "assigned" | "unsold";
  }) => Promise<{ error?: string }>;
  deleteEvent: (eventId: string) => Promise<void>;
  /**
   * I giocatori che hai messo tu nel piano, col prezzo che hai deciso tu.
   *
   * Restano finche' non li togli: non li tocca il consiglio, non li tocca una
   * chiamata registrata da qualcun altro. Sono l'unico posto in cui il software
   * prende ordini invece di darli.
   */
  /** Chi e' sul piatto adesso, per tutta la lega. Lo dice un premium o un admin. */
  setGiocatoreInAsta: (playerId: string | null) => Promise<{ error?: string }>;
  /** A quanto siamo e chi e' davanti: lo vedono tutti nello stesso istante. */
  setOffertaCorrente: (price: number, bidderId: string | null) => Promise<{ error?: string }>;
  /**
   * "Si', e' lui": da qui il nome sul piatto non si muove piu'.
   *
   * Finche' nessuno conferma, il giocatore in asta e' un'ipotesi del microfono.
   * Dopo, il microfono puo' solo far salire la cifra — e per cambiare giocatore
   * bisogna togliere la conferma a mano, che e' un gesto di chi conduce.
   */
  setChiamataConfermata: (confermata: boolean) => Promise<{ error?: string }>;
  /**
   * La lista ristretta: chi puo' essere chiamato all'asta.
   *
   * Vuota vuol dire "tutti", ed e' il caso normale finche' la lega non ne
   * definisce una. Quando c'e', comanda: il piano, i consigli, la chiamata e il
   * microfono lavorano solo su questi, e gli altri restano cercabili ma non
   * chiamabili.
   */
  lista: Set<string>;
  /** Il listone ridotto alla lista, quando c'e': e' il mercato vero. */
  giocatoriInAsta: PlayerWithStats[];
  ricaricaLista: () => Promise<void>;
  pins: RosterPin[];
  setPin: (playerId: string, price: number) => Promise<{ error?: string }>;
  removePin: (playerId: string) => Promise<void>;
  clearPins: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Ricarica listone e statistiche: serve dopo un import o una cancellazione. */
  reloadPlayers: () => Promise<void>;
};

const LeagueCtx = createContext<Ctx | null>(null);

export function useLeague() {
  const ctx = useContext(LeagueCtx);
  if (!ctx) throw new Error("useLeague fuori dal provider");
  return ctx;
}

export default function LeagueDataProvider({
  league: leagueIniziale,
  participants: initialParticipants,
  me,
  activeStrategy,
  isOwner,
  livello,
  children,
}: {
  league: LeagueRow;
  participants: ParticipantRow[];
  me: ParticipantRow | null;
  activeStrategy: ActiveStrategy;
  isOwner: boolean;
  livello: Livello;
  children: ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [players, setPlayers] = useState<PlayerWithStats[]>([]);
  const [valutazioni, setValutazioni] = useState<ValutazioniSerializzate | null>(null);
  const [pins, setPins] = useState<RosterPin[]>([]);
  const [lista, setLista] = useState<Set<string>>(new Set());
  // La lega arriva dal server, ma `current_player_id` cambia mentre l'asta va:
  // deve poter essere aggiornata senza ricaricare la pagina.
  const [league, setLeague] = useState<LeagueRow>(leagueIniziale);
  const [events, setEvents] = useState<AuctionEventRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>(initialParticipants);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Il listone: nomi, squadre, statistiche, carriera. Fatti, per tutti.
   *
   * Arriva da Supabase, che pagina da solo e non ha il tetto di 4.5 MB delle
   * funzioni: sono quasi due megabyte, e non c'e' motivo di farli passare da un
   * nostro endpoint. I prezzi del modello invece sono un'altra cosa e vengono
   * da un'altra parte — vedi `loadValutazioni`.
   */
  const loadPlayers = useCallback(async () => {
    const all: PlayerWithStats[] = [];
    const pageSize = 1000;
    // PostgREST restituisce mille righe per volta e non lo dice: senza paginare,
    // seicento giocatori diventano cinquecento e nessuno se ne accorge.
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("players")
        // Colonne esplicite invece di player_stats(*): la tabella porta anche id,
        // player_id e created_at per ogni riga, che qui non servono e su 1600
        // righe pesano un terzo del trasferimento.
        .select(
          "id, season, external_id, name, team, role, quotation_initial, quotation_current, fvm, is_active," +
            " player_stats(season, competition, club, source, source_detail, rating, matches, minutes, avg_vote, avg_fantavote," +
            " goals, assists, own_goals, yellow_cards, red_cards, pen_scored, pen_missed, pen_saved," +
            " goals_conceded, clean_sheets)",
        )
        .eq("season", league.season)
        .eq("is_active", true)
        .order("name")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []).map((row) => {
        // La select e' composta a pezzi, quindi il tipo dedotto non e' utilizzabile:
        // la forma la conosciamo, e le righe passano comunque da PlayerWithStats.
        const raw = row as unknown as Record<string, unknown> & {
          player_stats: PlayerWithStats["stats"][];
        };
        const { player_stats, ...rest } = raw;
        // Tutte le stagioni, dalla piu' recente: il motore le fonde con peso
        // decrescente, la scheda giocatore mostra la prima.
        const history = (player_stats ?? [])
          .filter(Boolean)
          .slice()
          .sort((a, b) => (a!.season < b!.season ? 1 : -1)) as NonNullable<PlayerWithStats["stats"]>[];
        return {
          ...(rest as unknown as PlayerRow),
          stats: history[0] ?? null,
          history,
        } as PlayerWithStats;
      });
      all.push(...batch);
      if (batch.length < pageSize) break;
    }

    // Identita' e carriera riguardano una minoranza di giocatori (quelli senza
    // storico di Serie A): due query a parte pesano molto meno che allargare la
    // prima a tutti e cinquecento.
    const [identities, career, absences, status] = await Promise.all([
      supabase.from("player_identities").select("*"),
      supabase.from("player_career").select("*").order("season", { ascending: false }),
      supabase.from("player_absences").select("*"),
      supabase.from("player_status").select("*"),
    ]);
    const perId = new Map(
      (identities.data ?? []).map((i) => [i.player_id, i as unknown as PlayerIdentity]),
    );
    const perCareer = new Map<string, CareerRow[]>();
    for (const c of (career.data ?? []) as unknown as CareerRow[]) {
      perCareer.set(c.player_id, [...(perCareer.get(c.player_id) ?? []), c]);
    }
    const perStato = new Map(
      ((status.data ?? []) as unknown as StatusRow[]).map((x) => [x.player_id, x]),
    );
    const perAssenze = new Map<string, AbsenceRow[]>();
    for (const a of (absences.data ?? []) as unknown as AbsenceRow[]) {
      perAssenze.set(a.player_id, [...(perAssenze.get(a.player_id) ?? []), a]);
    }
    for (const p of all) {
      p.identity = perId.get(p.id) ?? null;
      p.career = perCareer.get(p.id) ?? [];
      p.absences = perAssenze.get(p.id) ?? [];
      p.status = perStato.get(p.id) ?? null;
    }

    setPlayers(all);
  }, [supabase, league.season]);

  /**
   * I prezzi del modello, dal server.
   *
   * Prima li calcolava il browser: `buildValuations` girava qui dentro, e il
   * livello dell'utenza era una tenda invece che un muro — nascondere i prezzi
   * nell'interfaccia non serve se restano nella memoria della scheda. Adesso
   * arrivano gia' fatti, e a chi non ha il premium non arrivano affatto: non
   * sono filtrati in uscita, non vengono proprio calcolati.
   */
  const loadValutazioni = useCallback(async () => {
    const res = await fetch(`/api/lega/${league.id}/valutazioni`, { cache: "no-store" });
    // Il corpo si legge come testo e si prova a interpretarlo dopo.
    //
    // Un 500 non ha per forza un JSON dentro, e chiamare `res.json()` per primo
    // trasformava un errore del server in "Failed to execute 'json' on
    // 'Response'" — un messaggio che non dice niente a nessuno, meno che mai
    // durante un'asta.
    const testo = await res.text();
    let json: { valutazioni?: unknown; error?: string } = {};
    try {
      json = testo ? JSON.parse(testo) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      throw new Error(
        json.error ?? `Non riesco a calcolare i prezzi (errore ${res.status}). Riprova.`,
      );
    }
    setValutazioni((json.valutazioni ?? null) as ValutazioniSerializzate | null);
  }, [league.id]);

  const loadPins = useCallback(async () => {
    if (!me) return;
    const { data } = await supabase
      .from("roster_pins")
      .select("id, player_id, price")
      .eq("league_id", league.id)
      .eq("participant_id", me.id);
    setPins((data ?? []) as RosterPin[]);
  }, [supabase, league.id, me]);

  const setPin = useCallback<Ctx["setPin"]>(
    async (playerId, price) => {
      if (!me) return { error: "Non sei un partecipante di questa lega." };
      const { error } = await supabase.from("roster_pins").upsert(
        {
          league_id: league.id,
          participant_id: me.id,
          player_id: playerId,
          price: Math.max(1, Math.round(price)),
        },
        { onConflict: "league_id,participant_id,player_id" },
      );
      if (error) return { error: error.message };
      await loadPins();
      return {};
    },
    [supabase, league.id, me, loadPins],
  );

  const removePin = useCallback<Ctx["removePin"]>(
    async (playerId) => {
      if (!me) return;
      await supabase
        .from("roster_pins")
        .delete()
        .eq("league_id", league.id)
        .eq("participant_id", me.id)
        .eq("player_id", playerId);
      await loadPins();
    },
    [supabase, league.id, me, loadPins],
  );

  const clearPins = useCallback<Ctx["clearPins"]>(async () => {
    if (!me) return;
    await supabase
      .from("roster_pins")
      .delete()
      .eq("league_id", league.id)
      .eq("participant_id", me.id);
    await loadPins();
  }, [supabase, league.id, me, loadPins]);

  /** La lista ristretta della lega, se ne ha una. */
  const ricaricaLista = useCallback(async () => {
    const { data } = await supabase
      .from("league_shortlist")
      .select("player_id")
      .eq("league_id", leagueIniziale.id);
    setLista(new Set((data ?? []).map((r) => r.player_id as string)));
  }, [supabase, leagueIniziale.id]);

  /**
   * I rilanci sentiti su chi e' in asta adesso.
   *
   * Non stanno nel database: sono la storia di come l'offerta e' cambiata
   * mentre la chiamata era aperta, e a chiamata chiusa non interessano piu' a
   * nessuno. Si accumulano qui, dove le variazioni della lega arrivano
   * davvero, invece che dentro un effetto: un effetto che accumula stato
   * finisce per rincorrere se stesso.
   */
  const [puntate, setPuntate] = useState<Puntata[]>([]);
  const [rimozioni, setRimozioni] = useState<Rimozione[]>([]);
  const [spostamenti, setSpostamenti] = useState<Spostamento[]>([]);

  const loadLega = useCallback(async () => {
    const { data } = await supabase.from("leagues").select("*").eq("id", leagueIniziale.id).single();
    if (!data) return;
    const nuova = data as LeagueRow;
    setLeague((prima) => {
      const cambiaGiocatore = prima.current_player_id !== nuova.current_player_id;
      const prezzo = nuova.current_price ?? null;
      if (cambiaGiocatore || nuova.current_player_id == null) {
        setPuntate(
          prezzo != null && nuova.current_player_id
            ? [{ prezzo, chi: nuova.current_bidder ?? null, quando: Date.now() }]
            : [],
        );
      } else if (prezzo != null && prezzo !== (prima.current_price ?? null)) {
        setPuntate((p) => [...p, { prezzo, chi: nuova.current_bidder ?? null, quando: Date.now() }].slice(-12));
      }
      return nuova;
    });
  }, [supabase, leagueIniziale.id]);

  /**
   * Dire alla lega chi e' in asta adesso.
   *
   * Passa da una RPC e non da una scrittura diretta: le regole della lega le
   * cambia solo chi l'ha creata, ma questo non e' una regola — e' lo stato
   * dell'asta, e lo puo' dire chiunque conduca. La porta e' stretta e separata.
   */
  const setGiocatoreInAsta = useCallback<Ctx["setGiocatoreInAsta"]>(
    async (playerId) => {
      const { error } = await supabase.rpc("set_current_player", {
        p_league: leagueIniziale.id,
        p_player: playerId,
      });
      if (error) return { error: error.message };
      await loadLega();
      return {};
    },
    [supabase, leagueIniziale.id, loadLega],
  );

  /**
   * L'offerta della chiamata in corso.
   *
   * Non passa da `loadLega` perche' cambia molte volte al minuto mentre il
   * banditore conta: si scrive e si aspetta che il realtime la riporti a tutti,
   * questo browser compreso. Una scrittura, un giro solo.
   */
  const setOffertaCorrente = useCallback<Ctx["setOffertaCorrente"]>(
    async (price, bidderId) => {
      // Ottimistica: chi conduce non puo' aspettare il giro del server per
      // vedere il numero che ha appena battuto.
      setLeague((l) => ({ ...l, current_price: price, current_bidder: bidderId }));
      const { error } = await supabase.rpc("set_current_bid", {
        p_league: leagueIniziale.id,
        p_price: Math.max(1, Math.round(price)),
        p_bidder: bidderId,
      });
      if (error) {
        await loadLega();
        return { error: error.message };
      }
      return {};
    },
    [supabase, leagueIniziale.id, loadLega],
  );

  const setChiamataConfermata = useCallback<Ctx["setChiamataConfermata"]>(
    async (confermata) => {
      setLeague((l) => ({ ...l, current_locked: confermata }));
      const { error } = await supabase.rpc("set_call_locked", {
        p_league: leagueIniziale.id,
        p_locked: confermata,
      });
      if (error) {
        await loadLega();
        return { error: error.message };
      }
      await loadLega();
      return {};
    },
    [supabase, leagueIniziale.id, loadLega],
  );

  const loadEvents = useCallback(async () => {
    const { data, error } = await supabase
      .from("auction_events")
      .select("*")
      .eq("league_id", league.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const arrivati = (data ?? []) as AuctionEventRow[];
    setEvents((prima) => {
      // Quello che c'era e non c'e' piu' e' stato annullato: se ne tiene una
      // riga, perche' durante un'asta "era suo e non lo e' piu'" e' una
      // notizia. Solo se prima c'era qualcosa: al primo caricamento la lista
      // e' vuota per forza e non significa niente.
      if (prima.length > 0) {
        const adesso = new Set(arrivati.map((e) => e.id));
        const spariti = prima.filter((e) => !adesso.has(e.id));
        // Un'azzerata pulisce la lista invece di riempirla di righe barrate:
        // la regola sta in `eUnAzzeramento`, con scritto perche'.
        if (eUnAzzeramento(spariti.length, arrivati.length)) {
          setRimozioni([]);
        } else if (spariti.length > 0) {
          setRimozioni((r) =>
            [
              ...spariti.map((e) => ({
                playerId: e.player_id,
                participantId: e.participant_id,
                prezzo: e.price,
                quando: Date.now(),
              })),
              ...r,
            ].slice(0, 20),
          );
        }
      }
      // Stessa riga, altro padrone (o altra cifra): e' una correzione fatta
      // sul tabellone, e va raccontata come le altre.
      if (prima.length > 0) {
        const primaPerId = new Map(prima.map((e) => [e.id, e]));
        const cambiati = arrivati.flatMap((e) => {
          const p = primaPerId.get(e.id);
          if (!p) return [];
          if (p.participant_id === e.participant_id && p.price === e.price) return [];
          return [
            {
              playerId: e.player_id,
              daParticipant: p.participant_id,
              aParticipant: e.participant_id,
              prezzoPrima: p.price,
              prezzo: e.price,
              quando: Date.now(),
            },
          ];
        });
        if (cambiati.length > 0) setSpostamenti((s) => [...cambiati, ...s].slice(0, 20));
      }
      return arrivati;
    });
  }, [supabase, league.id]);

  const loadParticipants = useCallback(async () => {
    const { data } = await supabase
      .from("participants")
      .select("*")
      .eq("league_id", league.id)
      .order("created_at");
    if (data) setParticipants(data as ParticipantRow[]);
  }, [supabase, league.id]);

  const refresh = useCallback(async () => {
    await Promise.all([loadEvents(), loadParticipants()]);
  }, [loadEvents, loadParticipants]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([
          loadPlayers(),
          loadValutazioni(),
          loadEvents(),
          loadParticipants(),
          loadPins(),
          ricaricaLista(),
        ]);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlayers, loadValutazioni, loadEvents, loadParticipants, loadPins, ricaricaLista]);

  // L'asta e' condivisa: se un altro membro registra un acquisto lo vediamo subito.
  useEffect(() => {
    const channel = supabase
      .channel(`league-${league.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "auction_events", filter: `league_id=eq.${league.id}` },
        () => void loadEvents(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `league_id=eq.${league.id}` },
        () => {
          void loadParticipants();
          // I prezzi di equilibrio dipendono da quante squadre ci sono e da
          // quanti crediti hanno: una squadra aggiunta o un budget corretto li
          // cambia per tutti, e adesso quel conto sta sul server. Succede
          // qualche volta prima dell'asta, non durante.
          void loadValutazioni();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leagues", filter: `id=eq.${league.id}` },
        () => void loadLega(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, league.id, loadEvents, loadParticipants, loadValutazioni, loadLega]);

  /**
   * La rete di sicurezza sotto il realtime.
   *
   * Il socket e' la strada normale e adesso funziona — `leagues` non era nella
   * pubblicazione, quindi l'evento non partiva proprio. Ma un socket cade: il
   * portatile va in sospensione, il wifi della stanza fa i capricci, il
   * browser mette in pausa una scheda in secondo piano. E il giorno dell'asta
   * "si era disconnesso e non me ne sono accorto" e' il modo peggiore di
   * perdere una chiamata.
   *
   * Quindi finche' una chiamata e' aperta si rilegge la riga della lega ogni
   * tre secondi. E' una riga sola, e vale la certezza che tutti vedano la
   * stessa cifra: quando non c'e' nessuna chiamata in corso, non fa niente.
   */
  useEffect(() => {
    if (!league.current_player_id) return;
    const t = setInterval(() => void loadLega(), 3000);
    return () => clearInterval(t);
  }, [league.current_player_id, loadLega]);

  /** Tornando sulla scheda si riallinea subito: mentre era nascosta puo' essere successo di tutto. */
  useEffect(() => {
    const sveglia = () => {
      if (document.visibilityState === "visible") {
        void loadLega();
        void loadEvents();
      }
    };
    document.addEventListener("visibilitychange", sveglia);
    window.addEventListener("focus", sveglia);
    return () => {
      document.removeEventListener("visibilitychange", sveglia);
      window.removeEventListener("focus", sveglia);
    };
  }, [loadLega, loadEvents]);

  const playerMap = useMemo(
    () => new Map<string, PlayerRow>(players.map((p) => [p.id, p])),
    [players],
  );

  /**
   * Il mercato vero: il listone, o la lista ristretta se la lega ne ha una.
   *
   * Il listone intero resta a disposizione della ricerca — un giocatore fuori
   * lista si puo' sempre guardare — ma tutto quello che **prevede** l'asta (il
   * piano, i ripieghi, la scarsita', le probabilita') deve ragionare su chi
   * verra' davvero chiamato. Altrimenti il software conta su un ricambio che
   * all'asta non esiste.
   */
  const giocatoriInAsta = useMemo(
    () => (lista.size === 0 ? players : players.filter((p) => lista.has(p.id))),
    [players, lista],
  );

  /**
   * Le valutazioni ricevute, rimesse nella forma che il motore si aspetta.
   *
   * `byRole` non viaggia sul filo: e' `byPlayer` raggruppato e ordinato, e
   * mandarlo sarebbe spedire ogni valutazione due volte. Si ricostruisce con
   * `rankInRole`, che il server ha gia' calcolato.
   *
   * Senza premium resta un risultato vuoto e coerente: le mappe ci sono e sono
   * vuote, cosi' `buildMarketState` e i componenti non devono sapere niente di
   * livelli — trovano semplicemente un mercato senza prezzi.
   */
  const valuations = useMemo<ValuationResult>(() => {
    const byPlayer = new Map<string, Valuation>();
    const byRole: RoleMap<Valuation[]> = { P: [], D: [], C: [], A: [] };
    for (const v of valutazioni?.perGiocatore ?? []) {
      byPlayer.set(v.playerId, v);
      byRole[v.role].push(v);
    }
    for (const r of ROLES) byRole[r].sort((a, b) => a.rankInRole - b.rankInRole);
    return {
      byPlayer,
      byRole,
      replacementFM: valutazioni?.replacementFM ?? { P: 0, D: 0, C: 0, A: 0 },
      replacementMV: valutazioni?.replacementMV ?? { P: 0, D: 0, C: 0, A: 0 },
      matchdaysPlayed: valutazioni?.matchdaysPlayed ?? 0,
      benchDepth: valutazioni?.benchDepth ?? 0,
      anchoredOnRealPrices: valutazioni?.anchoredOnRealPrices ?? false,
      pricePerVOR: valutazioni?.pricePerVOR ?? 0,
      totalMarketValue: valutazioni?.totalMarketValue ?? 0,
    };
  }, [valutazioni]);

  const state = useMemo(
    () =>
      buildMarketState({
        league,
        participants,
        events,
        players: playerMap,
        valuations: valuations.byPlayer,
        myParticipantId: me?.id ?? null,
      }),
    [league, participants, events, playerMap, valuations, me?.id],
  );

  // Il confronto fra strategie e' un consiglio, e senza valutazioni non
  // avrebbe nemmeno gli ingredienti: senza premium non si calcola.
  const review = useMemo(
    () =>
      conConsigli(livello)
        ? reviewStrategies({
            state,
            valuations,
            allPlayers: giocatoriInAsta,
            activeKey: activeStrategy?.key ?? null,
          })
        : REVIEW_VUOTA,
    [state, valuations, giocatoriInAsta, activeStrategy?.key, livello],
  );

  /** Dopo un import o una cancellazione il listone e' un altro: e i prezzi con lui. */
  const ricaricaTutto = useCallback(async () => {
    await Promise.all([loadPlayers(), loadValutazioni()]);
  }, [loadPlayers, loadValutazioni]);

  const recordEvent = useCallback<Ctx["recordEvent"]>(
    async ({ playerId, participantId, price, outcome }) => {
      const { error } = await supabase.from("auction_events").upsert(
        {
          league_id: league.id,
          player_id: playerId,
          participant_id: participantId,
          price: Math.max(0, Math.round(price)),
          outcome,
        },
        { onConflict: "league_id,player_id" },
      );
      if (error) return { error: error.message };
      // Registrato: la chiamata e' finita, e la schermata si azzera per tutti.
      // Chi non ha il premium non puo' chiuderla, e va bene: la chiude chi
      // conduce, un istante dopo.
      if (conConsigli(livello)) {
        await supabase.rpc("set_current_player", { p_league: league.id, p_player: null });
        await loadLega();
      }
      await loadEvents();
      return {};
    },
    [supabase, league.id, loadEvents, loadLega, livello],
  );

  const deleteEvent = useCallback(
    async (eventId: string) => {
      await supabase.from("auction_events").delete().eq("id", eventId);
      await loadEvents();
    },
    [supabase, loadEvents],
  );

  const value: Ctx = {
    loading,
    error,
    league,
    players,
    playerMap,
    valuations,
    events,
    puntate,
    rimozioni,
    spostamenti,
    participants,
    me,
    isOwner,
    livello,
    activeStrategy,
    state,
    review,
    recordEvent,
    deleteEvent,
    setGiocatoreInAsta,
    setOffertaCorrente,
    setChiamataConfermata,
    lista,
    giocatoriInAsta,
    ricaricaLista,
    pins,
    setPin,
    removePin,
    clearPins,
    refresh,
    reloadPlayers: ricaricaTutto,
  };

  return <LeagueCtx.Provider value={value}>{children}</LeagueCtx.Provider>;
}
