import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  apiFootballConfig,
  apiSeasonToLabel,
  availableSeasons,
  currentApiSeason,
  fetchPlayerSeason,
  ping,
  probe,
  PROBE_PATHS,
  searchPlayer,
  type ProbePath,
  type ApiFootballConfig,
  type ExternalSeasonStats,
} from "@/lib/fanta/apiFootball";
import {
  buildIdentifyPrompt,
  buildStatsPrompt,
  parseIdentities,
  searchTerm,
  type Identity,
  type PlayerToIdentify,
} from "@/lib/fanta/identify";
import { askOpenRouterJson } from "@/lib/fanta/openrouter";
import {
  dropWhereBetterExists,
  preferBestSource,
  type StatRow,
} from "@/lib/fanta/externalStats";
import { competitionByKey } from "@/lib/fanta/competitions";
import { rubaIdentita } from "@/lib/fanta/rosters";
import { separaIncoerenti } from "@/lib/fanta/coherence";
import { canOverwrite, isExpansionOf, NOMI } from "@/lib/fanta/reliability";
import {
  budgetOra,
  dopoLaCorsa,
  MAX_CALLS_PER_DAY,
  readApiMemory,
  writeApiMemory,
  type ApiMemory,
} from "@/lib/apiState";
import {
  apiCallsPerPlayer,
  chunk,
  identifyTokenBudget,
  IDENTIFY_CHUNK,
  learnSeasons,
  planBatch,
  toRecover,
  usableSeasons,
  type RecoveryState,
  type SeasonEvidence,
} from "@/lib/fanta/recovery";
import type { Role } from "@/lib/fanta/types";

export const runtime = "nodejs";
/**
 * Il piano Hobby tronca la funzione a 60 secondi qualunque cosa dica questo
 * numero, e una funzione troncata non scrive niente perche' l'inserimento e' in
 * fondo. Dichiararne 300 faceva solo credere di avere un margine che non c'e':
 * il lotto va tenuto corto, e la misura dice quanto.
 */
export const maxDuration = 60;

/**
 * Quanti giocatori per lotto.
 *
 * Misurato con `npm run check:recovery`: sei giocatori (una chiamata di
 * identificazione piu' sei di statistiche in parallelo) prendono 9,5 secondi.
 * Il costo di un lotto e' quasi tutto attesa in parallelo, quindi cresce molto
 * meno che linearmente: venti stanno larghi dentro i 60 secondi. Alzarlo ancora
 * non conviene — un lotto troncato si paga e non salva niente.
 */
const LOTTO_DEFAULT = 20;
const LOTTO_MAX = 40;

/**
 * Chiamate contemporanee a OpenRouter. Un lotto da 40 tutto insieme e' una
 * raffica, e i limiti al minuto li' non li conosciamo.
 */
const MAX_PARALLELE = 12;

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Found = { season: string; competition: string; matches: number; goals: number };

type Outcome = {
  playerId: string;
  name: string;
  status: "ok" | "identificato" | "non-trovato" | "errore" | "rimandato";
  /** Chi ha fornito i numeri finiti nel database. */
  via?: "api" | "ai" | null;
  resolvedName?: string | null;
  confidence?: string | null;
  note?: string | null;
  seasons?: Found[];
  message?: string;
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Non autenticato" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return {
      error: NextResponse.json(
        { error: "Serve un account amministratore per scrivere sul listone." },
        { status: 403 },
      ),
    };
  }
  return { supabase };
}

/** Verifica la chiave, dice quali stagioni il piano espone e lo ricorda. */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;

  const cfg = apiFootballConfig();

  // La sonda: `?probe=/players/squads&team=489`. Riporta la risposta grezza,
  // troncata, per sapere che forma ha davvero invece di dedurla.
  const url = new URL(request.url);
  const percorso = url.searchParams.get("probe");
  if (percorso) {
    if (!cfg) return NextResponse.json({ error: "Chiave non configurata." }, { status: 503 });
    if (!(PROBE_PATHS as readonly string[]).includes(percorso)) {
      return NextResponse.json(
        { error: `Percorso non ammesso. Disponibili: ${PROBE_PATHS.join(", ")}` },
        { status: 400 },
      );
    }
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (k !== "probe") params[k] = v;
    const esito = await probe(cfg, percorso as ProbePath, params);
    const raw = esito.raw as { response?: unknown[]; paging?: unknown; results?: number } | null;
    const memoria = await readApiMemory(supabase);
    await writeApiMemory(supabase, { ...memoria, callsToday: memoria.callsToday + esito.calls });
    return NextResponse.json({
      percorso,
      params,
      error: esito.error,
      results: raw?.results ?? null,
      paging: raw?.paging ?? null,
      // Solo le prime due voci: serve la forma, non il contenuto.
      primi: Array.isArray(raw?.response) ? raw.response.slice(0, 2) : raw,
    });
  }
  if (!cfg) {
    return NextResponse.json({
      configured: false,
      message:
        "APIFOOTBALL_KEY non configurata. Restano la ricerca AI e l'inserimento manuale.",
    });
  }
  const res = await ping(cfg);
  if (res.error) {
    return NextResponse.json({ configured: true, ok: false, host: cfg.host, message: res.error });
  }
  const memory = await readApiMemory(supabase);
  const seasons = await availableSeasons(cfg);
  const declared = seasons.data ?? memory.declared;
  const aggiornata: ApiMemory = {
    ...memory,
    declared,
    updatedAt: new Date().toISOString(),
    callsToday: memory.callsToday + seasons.calls,
  };
  await writeApiMemory(supabase, aggiornata);

  const usable = usableSeasons(aggiornata, currentApiSeason());
  return NextResponse.json({
    configured: true,
    ok: true,
    host: cfg.host,
    message: "Chiave valida.",
    seasons: usable,
    seasonLabels: usable.map(apiSeasonToLabel),
    emptySeasons: aggiornata.empty.map(apiSeasonToLabel),
    detail: res.data ?? null,
  });
}

/** Esegue `fn` su tutti, ma non piu' di `limit` per volta. */
async function inParallelo<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let prossimo = 0;
  const operai = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = prossimo++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(operai);
  return out;
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;

  const body = await request.json().catch(() => ({}));
  const espliciti: string[] = Array.isArray(body.playerIds) ? body.playerIds.slice(0, LOTTO_MAX) : [];
  const take = Math.min(LOTTO_MAX, Math.max(1, Number(body.take) || LOTTO_DEFAULT));
  const mode: "auto" | "api" | "ai" =
    body.source === "api" ? "api" : body.source === "ai" ? "ai" : "auto";
  const web = body.web !== false;

  const memory = await readApiMemory(supabase);

  // -------------------------------------------------------------------------
  // 0. Chi lavorare. Se il chiamante non lo dice, lo sceglie il server: e' quello
  //    che rende il ciclo ripartibile senza che il browser tenga il segno, e che
  //    domani permette a un cron di chiamare lo stesso endpoint invece di
  //    riscriverne la logica.
  // -------------------------------------------------------------------------
  const scelta = await selectBatch(supabase, { espliciti, take, mode, memory });
  if ("error" in scelta) return scelta.error;
  const { targets, remaining, givenUp, apiBudget, listoneSeason } = scelta;

  if (targets.length === 0) {
    return NextResponse.json({
      source: mode,
      processed: 0,
      written: 0,
      skipped: 0,
      remaining,
      givenUp,
      done: remaining === 0,
      outcomes: [],
      avvisi: remaining > 0 ? ["Nessun giocatore lavorabile in questo lotto."] : [],
    });
  }

  const rows: StatRow[] = [];
  const avvisi: string[] = [];
  const via = new Map<string, "api" | "ai">();
  let cost = 0;
  let aiModel: string | null = null;

  // -------------------------------------------------------------------------
  // 1. Chi sono. Il listone li chiama "Ramos G."; senza il nome completo nessun
  //    archivio li trova. La squadra pero' la sappiamo, ed e' il vincolo che
  //    risolve gli omonimi.
  // -------------------------------------------------------------------------
  const identities = new Map<string, Identity>();
  const apiIds = new Map<string, number>();
  const ids = targets.map((p) => p.id);

  const { data: cached } = await supabase
    .from("player_identities")
    .select("*")
    .in("player_id", ids);
  // Le righe come stanno nel database: `Identity` non porta la fonte, e senza
  // la fonte non si sa chi ha il diritto di scrivere.
  const righeIdentita = new Map<string, Record<string, unknown>>();
  for (const row of cached ?? []) {
    righeIdentita.set(row.player_id, row as Record<string, unknown>);
    identities.set(row.player_id, {
      input: row.full_name ?? "",
      fullName: row.full_name,
      birthYear: row.birth_year,
      nationality: row.nationality,
      confidence: row.confidence,
      note: row.note,
      previous: (row.previous ?? []) as Identity["previous"],
      debutSeason: row.debut_season ?? null,
      debutClub: row.debut_club ?? null,
      debutCompetition: row.debut_competition ?? null,
      career: [],
    });
    if (row.api_player_id) apiIds.set(row.player_id, row.api_player_id);
  }

  // Un'identificazione a fiducia media puo' essere sbagliata: quella di
  // Woltemade lo era. Si ritenta finche' non e' "alta", tanto costa una sola
  // chiamata ogni sei e le identita' buone restano in cache.
  const daIdentificare = targets.filter((p) => {
    const i = identities.get(p.id);
    return !i || !i.fullName || i.confidence !== "alta";
  });

  if (mode !== "api" && daIdentificare.length > 0) {
    // Il listone intero: un'identificazione va confrontata con i compagni di
    // squadra, non solo con i venti del lotto.
    const { data: tuttiRaw } = await supabase
      .from("players")
      .select("id, name, team")
      .eq("is_active", true)
      .range(0, 999);
    const esito = await identifyLane(
      supabase,
      daIdentificare,
      web,
      righeIdentita,
      (tuttiRaw ?? []) as { id: string; name: string; team: string }[],
    );
    cost += esito.cost;
    if (esito.model) aiModel = esito.model;
    avvisi.push(...esito.avvisi);
    for (const [id, ident] of esito.identities) identities.set(id, ident);
    if (mode === "ai" && esito.identities.size === 0 && esito.fatale) {
      return NextResponse.json({ error: esito.fatale }, { status: 502 });
    }
  }

  // -------------------------------------------------------------------------
  // 2. I due rami corrono insieme. I colli di bottiglia sono indipendenti —
  //    l'archivio e' contingentato al minuto ma gratis, l'AI e' illimitata ma si
  //    paga — quindi il lotto dura quanto il piu' lento dei due, non quanto la
  //    somma. Nessun giocatore sta in entrambi: chi l'archivio non trova passa
  //    all'AI al lotto dopo, con l'esito registrato.
  // -------------------------------------------------------------------------
  const cfg = mode === "ai" ? null : apiFootballConfig();
  const anni = usableSeasons(memory, currentApiSeason());

  const [api, ai] = await Promise.all([
    cfg && apiBudget > 0
      ? apiLane(supabase, cfg, {
          players: scelta.apiPlayers,
          identities,
          apiIds,
          anni,
          memory,
          budget: apiBudget,
        })
      : Promise.resolve(null),
    mode !== "api" && scelta.aiPlayers.length > 0
      ? aiLane({ players: scelta.aiPlayers, identities, anni, web })
      : Promise.resolve(null),
  ]);

  if (api) {
    rows.push(...api.rows);
    for (const id of api.risolti) via.set(id, "api");
    if (api.stopped) avvisi.push(api.stopped);
  } else if (cfg && apiBudget === 0) {
    avvisi.push(
      memory.callsToday >= MAX_CALLS_PER_DAY
        ? "Archivio a quota per oggi: questo lotto lavora di sola AI."
        : "Archivio in pausa per il limite al minuto: questo lotto lavora di sola AI.",
    );
  }
  if (ai) {
    rows.push(...ai.rows);
    for (const id of ai.risolti) via.set(id, "ai");
    cost += ai.cost;
    if (ai.model) aiModel = ai.model;
    avvisi.push(...ai.avvisi);
  }

  // -------------------------------------------------------------------------
  // 3. Scrittura. Fra fonti diverse per la stessa stagione vince la migliore, e
  //    il file ufficiale non si tocca mai.
  // -------------------------------------------------------------------------
  // Prima di ogni altra cosa: una riga che si contraddice da sola e' inventata,
  // e non serve una seconda fonte per saperlo. Il modello aveva attribuito a un
  // difensore 315 presenze di Serie A — un campionato da 38 giornate — e la
  // riga era finita in archivio senza che niente la fermasse.
  const ruoli = new Map(targets.map((p) => [p.id, p.role as Role]));
  const { buone, scartate } = separaIncoerenti(rows, (r) => ruoli.get(String(r.player_id)) ?? "C");
  for (const sc of scartate.slice(0, 5)) {
    const chi = targets.find((p) => p.id === sc.riga.player_id)?.name ?? sc.riga.player_id;
    avvisi.push(`${chi} ${sc.riga.season}: riga scartata, ${sc.problemi.join("; ")}`);
  }

  const best = preferBestSource(buone);
  // Tutte le righe gia' presenti per questi giocatori, con la loro fonte: non
  // solo quelle ufficiali. La precedenza vale fra tutte le fonti, e fra un
  // lotto e l'altro non la applicava nessuno.
  const { data: gia } = await supabase
    .from("player_stats")
    .select("player_id, season, competition, club, source")
    .in("player_id", ids);
  const {
    keep: toWrite,
    skipped,
    protette,
  } = dropWhereBetterExists(
    best,
    (gia ?? []) as {
      player_id: string;
      season: string;
      competition: string;
      club: string | null;
      source: string | null;
    }[],
  );
  avvisi.push(...protette.slice(0, 5));

  if (toWrite.length > 0) {
    const { error } = await supabase
      .from("player_stats")
      .upsert(toWrite, { onConflict: "player_id,season,competition,club" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // -------------------------------------------------------------------------
  // 4. Lo stato, cosi' il lotto dopo non ripete questo. Si segna un tentativo
  //    solo a chi una fonte ha davvero interrogato ricevendo risposta: contare
  //    come tentativo una chiamata mai partita, o rifiutata dal limite al
  //    minuto, farebbe rinunciare a giocatori che nessuno ha mai cercato.
  // -------------------------------------------------------------------------
  const scritti = new Set(toWrite.map((r: StatRow) => String(r.player_id)));
  await saveRecoveryState(supabase, scelta.state, [
    ...(api?.interrogati ?? []).map((id) => ({
      player_id: id,
      channel: "api" as const,
      outcome: scritti.has(id) ? ("ok" as const) : ("non-trovato" as const),
    })),
    ...(ai?.interrogati ?? []).map((id) => ({
      player_id: id,
      channel: "ai" as const,
      outcome: scritti.has(id) ? ("ok" as const) : ("non-trovato" as const),
    })),
  ]);

  if (api) await writeApiMemory(supabase, api.memory);

  // -------------------------------------------------------------------------
  // 5. Il resoconto.
  // -------------------------------------------------------------------------
  // Chi il lotto non ha davvero interrogato non e' "non trovato": non e' stato
  // cercato. Dirlo diverso conta, perche' l'utente decide se insistere.
  const interrogati = new Set([...(api?.interrogati ?? []), ...(ai?.interrogati ?? [])]);
  const outcomes: Outcome[] = targets.map((p) => {
    const ident = identities.get(p.id) ?? null;
    const mine = toWrite.filter((r: StatRow) => r.player_id === p.id);
    if (mine.length === 0 && !interrogati.has(p.id)) {
      return {
        playerId: p.id,
        name: p.name,
        status: "rimandato" as const,
        resolvedName: ident?.fullName ?? null,
        message: "Nessuna fonte lo ha ancora cercato: torna nel prossimo lotto.",
      };
    }
    return {
      playerId: p.id,
      name: p.name,
      resolvedName: ident?.fullName ?? null,
      confidence: ident?.confidence ?? null,
      note: ident?.note ?? null,
      via: via.get(p.id) ?? null,
      status: mine.length > 0 ? "ok" : ident?.fullName ? "identificato" : "non-trovato",
      seasons: mine.map((r: StatRow) => ({
        season: String(r.season),
        competition: competitionByKey(String(r.competition)).label,
        matches: Number(r.matches ?? 0),
        goals: Number(r.goals ?? 0),
      })),
      message:
        mine.length === 0 && ident?.fullName
          ? "Identificato, ma nessuna statistica verificabile trovata."
          : undefined,
    };
  });
  const risolti =
    toWrite.length > 0 ? new Set(toWrite.map((r: StatRow) => String(r.player_id))).size : 0;

  return NextResponse.json({
    source: mode,
    listoneSeason,
    years: usableSeasons(api?.memory ?? memory, currentApiSeason()).map(apiSeasonToLabel),
    emptySeasons: (api?.memory ?? memory).empty.map(apiSeasonToLabel),
    processed: targets.length,
    written: toWrite.length,
    resolved: risolti,
    /**
     * Su quanti una fonte ha davvero ricevuto risposta. E' diverso da
     * `processed`, che dice solo quanti erano nel lotto: se una chiave manca o
     * il fornitore e' giu', il lotto "lavora" venti giocatori e non ne
     * interroga nessuno. Senza questo numero un ciclo cosi' gira a vuoto finche'
     * qualcuno non lo guarda.
     */
    attempted: interrogati.size,
    skipped,
    incoerenti: scartate.length,
    stopped: api?.stopped ?? null,
    apiCalls: api?.calls ?? 0,
    apiCallsToday: (api?.memory ?? memory).callsToday,
    cost: cost || null,
    model: aiModel,
    avvisi,
    // Quanti restavano prima di questo lotto, meno quelli appena risolti.
    remaining: Math.max(0, remaining - risolti),
    givenUp,
    done: Math.max(0, remaining - risolti) === 0,
    outcomes,
  });
}

// ---------------------------------------------------------------------------
// Scelta del lotto
// ---------------------------------------------------------------------------

type Target = PlayerToIdentify & { quotation_current: number | null; fvm: number | null };

async function selectBatch(
  supabase: Supabase,
  args: {
    espliciti: string[];
    take: number;
    mode: "auto" | "api" | "ai";
    memory: ApiMemory;
  },
) {
  const { espliciti, take, mode, memory } = args;

  // Quante chiamate all'archivio si possono spendere adesso. Due limiti diversi:
  // il tetto del giorno, e i dieci al minuto — che sono quelli che mordono. Se
  // l'ultimo lotto e' appena passato, questo lavora di sola AI mentre il minuto
  // si ricarica, invece di stare fermo ad aspettarlo.
  const apiBudget = mode === "ai" ? 0 : budgetOra(memory);

  const colonne = "id, name, team, role, season, quotation_current, fvm";

  if (espliciti.length > 0) {
    const { data } = await supabase.from("players").select(colonne).in("id", espliciti);
    if (!data?.length) {
      return { error: NextResponse.json({ error: "Giocatori non trovati." }, { status: 404 }) };
    }
    const targets = data as unknown as (Target & { season: string })[];
    const state = await loadRecoveryState(supabase);
    // Con un elenco esplicito comanda il chiamante: sono i giocatori che ha
    // scelto lui, non quelli che il server avrebbe pescato.
    const anni = usableSeasons(memory, currentApiSeason());
    const quantiApi = Math.floor(apiBudget / Math.max(2, apiCallsPerPlayer(anni, false)));
    return {
      targets,
      apiPlayers: mode === "ai" ? [] : targets.slice(0, quantiApi),
      aiPlayers: mode === "api" ? [] : targets.slice(mode === "ai" ? 0 : quantiApi),
      remaining: targets.length,
      givenUp: 0,
      state,
      apiBudget,
      listoneSeason: targets[0]?.season ?? null,
    };
  }

  // Il listone con le sole colonne che servono a capire chi e' ancora scoperto.
  // Le statistiche arrivano annidate: in cima PostgREST ne restituisce mille per
  // volta, e con 1600 righe piatte un terzo dei giocatori sembrerebbe senza
  // storico.
  const { data, error } = await supabase
    .from("players")
    .select(`${colonne}, player_stats(season, competition, matches)`)
    .eq("is_active", true)
    .order("quotation_current", { ascending: false, nullsFirst: false })
    .range(0, 999);
  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  type Riga = Target & {
    season: string;
    player_stats: { season: string; competition: string | null; matches: number }[] | null;
  };
  const listone = (data ?? []) as unknown as Riga[];
  const listoneSeason = listone[0]?.season ?? null;
  const coda = toRecover(
    listone.map((p) => ({ ...p, history: p.player_stats ?? [] })),
    listoneSeason ?? "",
  );

  const state = await loadRecoveryState(supabase);
  const anni = usableSeasons(memory, currentApiSeason());
  // Chi ha gia' l'id dell'archivio costa una chiamata in meno, ma si sconta sul
  // caso peggiore: un budget sforato diventa un 429, e un 429 ferma il lotto.
  // Il minimo e' due — una ricerca piu' un'annata — anche quando non sappiamo
  // ancora quali annate il piano copra, altrimenti il primo lotto della vita
  // pianificherebbe il triplo dei giocatori che riesce a servire.
  const callsPerPlayer = Math.max(2, apiCallsPerPlayer(anni, false));
  const quantiApi = Math.floor(apiBudget / callsPerPlayer);

  const piano = planBatch({
    queue: coda,
    state,
    // Con "solo archivio" il lotto e' grande quanto la quota del minuto: gli
    // altri non li lavorerebbe nessuno, e comparirebbero come non trovati senza
    // che nessuno li abbia cercati.
    size: mode === "api" ? quantiApi : take,
    apiCalls: apiBudget,
    callsPerPlayer,
  });

  const targets = [...piano.api, ...piano.ai].map(({ ...p }) => p as unknown as Target);
  return {
    targets,
    apiPlayers: piano.api as unknown as Target[],
    aiPlayers: mode === "api" ? [] : (piano.ai as unknown as Target[]),
    remaining: piano.remaining,
    givenUp: piano.givenUp,
    state,
    apiBudget,
    listoneSeason,
  };
}

/**
 * Lo stato di tutti, non solo del lotto: la tabella ha una riga per giocatore
 * gia' tentato, cioe' al massimo qualche centinaio, e serve intera per sapere
 * quanti restano davvero da lavorare.
 */
async function loadRecoveryState(supabase: Supabase) {
  const state = new Map<string, RecoveryState>();
  const { data } = await supabase
    .from("player_recovery")
    .select("player_id, api_attempts, api_outcome, ai_attempts, ai_outcome");
  for (const r of (data ?? []) as RecoveryState[]) state.set(r.player_id, r);
  return state;
}

async function saveRecoveryState(
  supabase: Supabase,
  state: Map<string, RecoveryState>,
  esiti: { player_id: string; channel: "api" | "ai"; outcome: "ok" | "non-trovato" }[],
) {
  if (esiti.length === 0) return;
  // Un giocatore puo' comparire una volta sola per canale in un lotto, ma non
  // due volte nella stessa upsert: Postgres rifiuta due righe con la stessa
  // chiave nello stesso comando.
  const perGiocatore = new Map<string, Record<string, unknown>>();
  for (const e of esiti) {
    const precedente = state.get(e.player_id);
    const riga = perGiocatore.get(e.player_id) ?? {
      player_id: e.player_id,
      api_attempts: precedente?.api_attempts ?? 0,
      api_outcome: precedente?.api_outcome ?? null,
      ai_attempts: precedente?.ai_attempts ?? 0,
      ai_outcome: precedente?.ai_outcome ?? null,
    };
    if (e.channel === "api") {
      riga.api_attempts = Number(riga.api_attempts) + 1;
      riga.api_outcome = e.outcome;
    } else {
      riga.ai_attempts = Number(riga.ai_attempts) + 1;
      riga.ai_outcome = e.outcome;
    }
    riga.last_attempt_at = new Date().toISOString();
    riga.updated_at = new Date().toISOString();
    perGiocatore.set(e.player_id, riga);
  }
  await supabase
    .from("player_recovery")
    .upsert([...perGiocatore.values()], { onConflict: "player_id" });
}

// ---------------------------------------------------------------------------
// I tre rami
// ---------------------------------------------------------------------------

/**
 * Identificazione, a gruppi di sei in parallelo.
 *
 * Sei e non venti: il prompt chiede sei stagioni di carriera per giocatore, e
 * oltre quella soglia la risposta sfonda il tetto dei token e torna troncata,
 * cioe' illeggibile. Un lotto grande si fa con piu' chiamate insieme, non con
 * una chiamata piu' grande.
 */
async function identifyLane(
  supabase: Supabase,
  players: Target[],
  web: boolean,
  esistenti: Map<string, Record<string, unknown>>,
  /** Tutto il listone: serve a sapere se un nome proposto e' gia' di un altro. */
  compagni: { id: string; name: string; team: string }[],
) {
  const identities = new Map<string, Identity>();
  const avvisi: string[] = [];
  let cost = 0;
  let model: string | null = null;
  let fatale: string | null = null;

  const gruppi = chunk(players, IDENTIFY_CHUNK);
  const risposte = await inParallelo(gruppi, MAX_PARALLELE, (gruppo) =>
    askOpenRouterJson<{ players?: Record<string, unknown>[] }>({
      prompt: buildIdentifyPrompt(gruppo),
      web,
      webResults: 10,
      maxTokens: identifyTokenBudget(gruppo.length),
      temperature: 0.1,
    }).then((answer) => ({ gruppo, answer })),
  );

  const daSalvare: Record<string, unknown>[] = [];
  const tappe: Record<string, unknown>[] = [];
  for (const { gruppo, answer } of risposte) {
    cost += answer.cost;
    if (!answer.ok) {
      fatale = answer.error;
      avvisi.push(`Identificazione fallita per ${gruppo.length} giocatori: ${answer.error}`);
      continue;
    }
    model = answer.model;
    const nuove = parseIdentities(answer.data as never, gruppo);
    for (const [id, ident] of nuove) {
      if (!ident.fullName) continue;
      // Un nome che appartiene a un altro giocatore della stessa rosa non e'
      // un'identificazione incerta: e' un'altra persona, e da li' in poi le
      // ricerche di statistiche pescherebbero lei.
      const io = gruppo.find((p) => p.id === id);
      const rubato = io
        ? rubaIdentita(
            ident.fullName,
            compagni.filter((c) => c.team === io.team && c.id !== io.id),
          )
        : null;
      if (rubato) {
        avvisi.push(
          `${io?.name}: scartato "${ident.fullName}", e' l'identita' di ${rubato} della stessa squadra`,
        );
        continue;
      }
      const riga = guardaIdentita(id, esistenti.get(id), ident, answer.model);
      if (riga.avviso) avvisi.push(riga.avviso);
      // Quello che finisce in memoria e' quello che finira' nel database: se il
      // nome dell'archivio ha resistito, i rami successivi devono usare quello,
      // non la proposta del modello.
      identities.set(id, { ...ident, fullName: String(riga.dati.full_name ?? ident.fullName) });
      daSalvare.push(riga.dati);
      // La carriera stagione per stagione: serve a distinguere un buco nei dati
      // da un'assenza vera, e a disegnare la scheda del giocatore.
      for (const c of ident.career) {
        tappe.push({
          player_id: id,
          season: c.season,
          club: c.club || null,
          competition: c.competition,
          country: c.country || null,
          status: c.status,
          is_debut: c.isDebut,
          source: "ai",
          model: answer.model,
          confidence: ident.confidence,
          note: ident.note,
        });
      }
    }
  }

  if (daSalvare.length > 0) {
    const { error } = await supabase
      .from("player_identities")
      .upsert(daSalvare, { onConflict: "player_id" });
    if (error) avvisi.push(`Identita' non salvate: ${error.message}`);
  }
  if (tappe.length > 0) {
    const { error } = await supabase
      .from("player_career")
      .upsert(tappe, { onConflict: "player_id,season,club" });
    if (error) avvisi.push(`Carriera non salvata: ${error.message}`);
  }

  return { identities, cost, model, avvisi, fatale };
}

/**
 * L'archivio sportivo. E' la fonte migliore e non costa denaro, ma il piano
 * gratuito ne serve pochi al minuto: qui si spende un budget deciso a monte e ci
 * si ferma, senza mai arrivare al 429.
 */
async function apiLane(
  supabase: Supabase,
  cfg: ApiFootballConfig,
  args: {
    players: Target[];
    identities: Map<string, Identity>;
    apiIds: Map<string, number>;
    anni: number[];
    memory: ApiMemory;
    budget: number;
  },
) {
  const { players, identities, apiIds, budget } = args;
  const rows: StatRow[] = [];
  const risolti = new Set<string>();
  const interrogati: string[] = [];
  const prove = new Map<number, SeasonEvidence>();
  let memory = args.memory;
  let anni = args.anni;
  let calls = 0;
  let stopped: string | null = null;

  // Se non sappiamo ancora quali annate il piano copra, una chiamata per
  // scoprirlo e' l'unico modo. Poi si ricorda: la lista cambia una volta l'anno,
  // e chiederla a ogni lotto costava un quarto della quota giornaliera.
  if (anni.length === 0 && memory.declared.length === 0) {
    const seasons = await availableSeasons(cfg);
    calls += seasons.calls;
    if (seasons.rateLimited) stopped = seasons.error;
    else {
      memory = { ...memory, declared: seasons.data ?? [], updatedAt: new Date().toISOString() };
      anni = usableSeasons(memory, currentApiSeason());
    }
  }

  for (const p of players) {
    if (stopped || calls >= budget || anni.length === 0) break;
    const ident = identities.get(p.id) ?? null;

    let apiId = apiIds.get(p.id) ?? null;
    if (!apiId) {
      const found = await searchPlayer(cfg, p.name, p.team, anni[0], {
        term: searchTerm(ident?.fullName ?? null, p.name),
        birthYear: ident?.birthYear ?? null,
      });
      calls += found.calls;
      if (found.rateLimited) {
        stopped = found.error;
        break;
      }
      if (found.data) {
        apiId = found.data.id;
        // L'archivio il nome vero ce l'ha: quello ipotizzato dall'AI viene
        // corretto, non tenuto. Su Woltemade l'AI aveva scritto "Sergiusz"
        // mentre l'archivio dice "Nick".
        await supabase.from("player_identities").upsert(
          {
            player_id: p.id,
            api_player_id: apiId,
            full_name: found.data.name,
            source: "api",
            // Un'identita' trovata nell'archivio e verificata sull'anno di
            // nascita e' alta per definizione. Senza dirlo, la regola che
            // ritenta chi non e' "alta" la rimandava al modello a ogni lotto —
            // e prima del guardiano il modello ci scriveva sopra.
            confidence: "alta",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "player_id" },
        );
        if (ident) ident.fullName = found.data.name;
      }
    }
    if (!apiId) {
      // L'archivio ha risposto e non lo conosce: e' un tentativo vero.
      interrogati.push(p.id);
      continue;
    }

    let interrogato = false;
    for (const year of anni) {
      if (calls >= budget) break;
      const season = await fetchPlayerSeason(cfg, apiId, year, p.role as Role);
      calls += season.calls;
      if (season.rateLimited) {
        stopped = season.error;
        break;
      }
      interrogato = true;
      // Solo una risposta arrivata davvero dice qualcosa sull'annata. Prima qui
      // finivano anche i rifiuti da limite al minuto, e bastavano due 429 perche'
      // un'annata buona venisse dichiarata muta per tutto il resto della corsa.
      const prova = prove.get(year) ?? { year, asked: 0, withData: 0 };
      prova.asked += 1;
      if (season.data?.length) {
        prova.withData += 1;
        risolti.add(p.id);
        for (const c of season.data) {
          rows.push(
            toRow(p.id, c, {
              provider: "api-football",
              api_player_id: apiId,
              resolved_name: ident?.fullName ?? null,
              confidence: ident?.confidence ?? null,
              note: ident?.note ?? null,
            }),
          );
        }
      }
      prove.set(year, prova);
    }
    if (interrogato) interrogati.push(p.id);

    // Quello che si impara vale gia' dal giocatore dopo: se l'annata piu' recente
    // torna vuota per tutti, smettere subito raddoppia i giocatori coperti dalla
    // stessa quota.
    memory = { ...memory, ...learnSeasons(memory, [...prove.values()]) };
    anni = usableSeasons(memory, currentApiSeason());
  }

  return {
    rows,
    risolti,
    interrogati,
    calls,
    stopped,
    // Se l'archivio ha dichiarato finita la giornata, il contatore si porta al
    // tetto: senza, ogni lotto del ciclo spenderebbe una chiamata per
    // riscoprire lo stesso muro.
    memory: dopoLaCorsa(memory, calls, stopped),
  };
}

/**
 * L'AI, un giocatore per chiamata e tutte insieme.
 *
 * Un giocatore per chiamata perche' la ricerca web restituisce pochi risultati
 * per richiesta, e divisi fra sei persone non bastano a verificare niente.
 */
async function aiLane(args: {
  players: Target[];
  identities: Map<string, Identity>;
  anni: number[];
  web: boolean;
}) {
  const { players, identities, web } = args;
  // Le annate da chiedere all'AI non dipendono dal piano dell'archivio: quelle
  // sono le due appena concluse, che e' quello che il motore sa pesare.
  const seasonLabels = [currentApiSeason() - 1, currentApiSeason() - 2].map(apiSeasonToLabel);

  const lavorabili = players.filter((p) => identities.get(p.id)?.fullName);
  const rows: StatRow[] = [];
  const risolti = new Set<string>();
  const interrogati: string[] = [];
  const avvisi: string[] = [];
  let cost = 0;
  let model: string | null = null;

  const risposte = await inParallelo(lavorabili, MAX_PARALLELE, (p) => {
    const i = identities.get(p.id)!;
    return askOpenRouterJson<{ players?: Record<string, unknown>[] }>({
      prompt: buildStatsPrompt(
        {
          name: p.name,
          fullName: i.fullName,
          team: p.team,
          role: p.role,
          clubs: i.previous.map((s) => `${s.season} ${s.club}`).join(", "),
        },
        seasonLabels,
      ),
      web,
      webResults: 10,
      maxTokens: 1200,
      temperature: 0.1,
    }).then((answer) => ({ p, answer }));
  });

  for (const { p, answer } of risposte) {
    cost += answer.cost;
    if (!answer.ok) {
      // Una chiamata fallita non dice niente sul giocatore: non e' un tentativo.
      avvisi.push(`${p.name}: ${answer.error}`);
      continue;
    }
    interrogati.push(p.id);
    model = answer.model;
    const ident = identities.get(p.id)!;
    const parsed = parseIdentities(answer.data as never, [
      { ...p, name: ident.fullName ?? p.name },
    ]);
    const found = parsed.get(p.id);
    for (const sp of found?.previous ?? []) {
      if (sp.matches <= 0) continue;
      risolti.add(p.id);
      rows.push({
        player_id: p.id,
        season: sp.season,
        competition: sp.competition,
        source: "ai",
        rating: sp.rating,
        matches: sp.matches,
        minutes: sp.minutes,
        avg_vote: null,
        avg_fantavote: null,
        goals: sp.goals,
        assists: sp.assists,
        own_goals: 0,
        yellow_cards: sp.yellow_cards,
        red_cards: sp.red_cards,
        pen_scored: 0,
        pen_missed: 0,
        pen_saved: 0,
        goals_conceded: p.role === "P" ? sp.goals_conceded : 0,
        clean_sheets: p.role === "P" ? sp.clean_sheets : 0,
        // La squadra non finisce piu' solo nella provenienza: e' una colonna, e
        // fa parte della chiave. Due mezze stagioni in due squadre sono due
        // righe, e lo storico lo dice.
        club: sp.club || "",
        source_detail: {
          provider: "ai",
          model: answer.model,
          web,
          resolved_name: ident.fullName,
          club: sp.club,
          confidence: ident.confidence,
          note: ident.note,
        },
      } as StatRow);
    }
  }

  return { rows, risolti, interrogati, cost, model, avvisi };
}

function toRow(
  playerId: string,
  c: ExternalSeasonStats,
  detail: Record<string, unknown>,
): StatRow {
  return {
    player_id: playerId,
    season: c.season,
    competition: c.competition,
    source: c.source ?? "api",
    rating: c.rating,
    matches: Math.round(c.matches),
    minutes: c.minutes,
    avg_vote: c.avg_vote,
    avg_fantavote: c.avg_fantavote,
    goals: Math.round(c.goals),
    assists: Math.round(c.assists),
    own_goals: Math.round(c.own_goals),
    yellow_cards: Math.round(c.yellow_cards),
    red_cards: Math.round(c.red_cards),
    pen_scored: Math.round(c.pen_scored),
    pen_missed: Math.round(c.pen_missed),
    pen_saved: Math.round(c.pen_saved),
    goals_conceded: Math.round(c.goals_conceded),
    clean_sheets: Math.round(c.clean_sheets),
    source_detail: detail,
  } as StatRow;
}

/**
 * Cosa il modello puo' scrivere su un'identita' che esiste gia'.
 *
 * Su un giocatore ci sono fatti diversi con padroni diversi. **Chi e'** — l'id
 * dell'archivio, l'anno di nascita — lo decide la fonte piu' affidabile e non
 * si discute. **Come si scrive** e' un'altra cosa: l'archivio restituisce
 * "J. Stones" e "K. Koulierakis", e congelare quelle abbreviazioni per
 * rispettare la gerarchia butterebbe via il dato migliore. Quindi il modello
 * puo' espandere un nome abbreviato, mai cambiarlo.
 *
 * Tutto il resto lo puo' solo **riempire dove e' vuoto**: nazionalita',
 * carriera, debutto, nota. Riempire un buco non e' sovrascrivere.
 */
function guardaIdentita(
  playerId: string,
  esistente: Record<string, unknown> | undefined,
  ident: Identity,
  model: string,
): { dati: Record<string, unknown>; avviso: string | null } {
  const completa = {
    full_name: ident.fullName,
    birth_year: ident.birthYear,
    nationality: ident.nationality,
    previous: ident.previous,
    confidence: ident.confidence,
    source: "ai",
    model,
    note: ident.note,
    debut_season: ident.debutSeason,
    debut_club: ident.debutClub,
    debut_competition: ident.debutCompetition,
    updated_at: new Date().toISOString(),
  };
  if (!esistente || canOverwrite("ai", esistente.source)) {
    // Stesse colonne dell'altro ramo, sempre: due forme diverse nello stesso
    // upsert si annullano a vicenda.
    return { dati: { player_id: playerId, ...completa }, avviso: null };
  }

  // Da qui in giu' comanda chi c'era: si riempie e basta.
  //
  // La riga parte pero' **completa**, con i valori esistenti, per due ragioni.
  // La prima e' che `source` non ammette il vuoto e l'upsert lo pretende anche
  // quando aggiorna: senza, l'intero lotto veniva rifiutato e la carriera
  // ricostruita dal modello non arrivava mai in archivio. La seconda e' che
  // PostgREST, davanti a righe con chiavi diverse, fa l'unione delle colonne e
  // azzera quelle che mancano: righe parziali accanto a righe complete
  // cancellano i campi che non nominano.
  const dati: Record<string, unknown> = {
    player_id: playerId,
    source: esistente.source,
    full_name: esistente.full_name,
    birth_year: esistente.birth_year,
    nationality: esistente.nationality,
    previous: esistente.previous ?? [],
    confidence: esistente.confidence,
    model: esistente.model,
    note: esistente.note,
    debut_season: esistente.debut_season,
    debut_club: esistente.debut_club,
    debut_competition: esistente.debut_competition,
    updated_at: new Date().toISOString(),
  };
  for (const campo of ["birth_year", "nationality", "note", "debut_season", "debut_club", "debut_competition"] as const) {
    if (esistente[campo] == null && completa[campo] != null) dati[campo] = completa[campo];
  }
  if (!Array.isArray(esistente.previous) || esistente.previous.length === 0) {
    dati.previous = completa.previous;
  }

  const vecchioNome = String(esistente.full_name ?? "");
  const nuovoNome = String(completa.full_name ?? "");
  let avviso: string | null = null;
  if (vecchioNome && nuovoNome && nuovoNome !== vecchioNome) {
    if (isExpansionOf(nuovoNome, vecchioNome)) {
      dati.full_name = nuovoNome;
    } else {
      avviso =
        `${vecchioNome}: tenuto il nome da ${NOMI[String(esistente.source) as keyof typeof NOMI] ?? esistente.source}, ` +
        `il modello proponeva "${nuovoNome}"`;
    }
  } else if (!vecchioNome && nuovoNome) {
    dati.full_name = nuovoNome;
  }
  return { dati: { ...dati, full_name: dati.full_name ?? vecchioNome }, avviso };
}
