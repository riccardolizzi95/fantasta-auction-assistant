import { resolveCompetition, shouldSkipCompetition, SERIE_A_KEY } from "./competitions";
import { punteggioSquadra } from "./rosters";
import type { PlayerStatsRow, Role } from "./types";

/**
 * Client per API-Football (api-sports.io), raggiungibile sia direttamente sia
 * via RapidAPI. Il piano gratuito da' 100 chiamate al giorno: ogni chiamata va
 * spesa con criterio, quindi qui si cerca il giocatore una volta sola e poi si
 * chiede una stagione per volta, non una competizione per volta (la risposta di
 * una stagione contiene gia' campionato e coppe).
 */

export type ApiFootballConfig = { key: string; host: string };

/** Id della Serie A su API-Football. Serve solo come rete di sicurezza in ricerca. */
const SERIE_A_LEAGUE_ID = 135;

/** L'anno con cui l'API identifica la stagione in corso (2026 = 2026/27). */
export function currentApiSeason(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

export function apiFootballConfig(): ApiFootballConfig | null {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) return null;
  // "direct" (API-SPORTS, il default) oppure "rapidapi": cambiano host e header.
  const mode = (process.env.APIFOOTBALL_MODE || "direct").toLowerCase();
  return {
    key,
    host: mode === "rapidapi" ? "api-football-v1.p.rapidapi.com" : "v3.football.api-sports.io",
  };
}

function headers(cfg: ApiFootballConfig): Record<string, string> {
  return cfg.host.includes("rapidapi")
    ? { "x-rapidapi-key": cfg.key, "x-rapidapi-host": cfg.host }
    : { "x-apisports-key": cfg.key };
}

function baseUrl(cfg: ApiFootballConfig): string {
  return cfg.host.includes("rapidapi") ? `https://${cfg.host}/v3` : `https://${cfg.host}`;
}

export type ApiCallResult<T> = {
  data: T | null;
  error: string | null;
  /** Chiamate consumate, per tenere il conto contro il limite giornaliero. */
  calls: number;
  rateLimited: boolean;
};

async function call<T>(
  cfg: ApiFootballConfig,
  path: string,
  params: Record<string, string | number>,
): Promise<ApiCallResult<T>> {
  const url = new URL(`${baseUrl(cfg)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, { headers: headers(cfg) });
  } catch (e) {
    return { data: null, error: `Rete non raggiungibile: ${(e as Error).message}`, calls: 1, rateLimited: false };
  }

  if (res.status === 429) {
    return { data: null, error: "Limite giornaliero di chiamate esaurito.", calls: 1, rateLimited: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { data: null, error: "Chiave API rifiutata: controlla APIFOOTBALL_KEY e APIFOOTBALL_MODE.", calls: 1, rateLimited: false };
  }
  if (!res.ok) {
    return { data: null, error: `API-Football ha risposto ${res.status}.`, calls: 1, rateLimited: false };
  }

  const json = (await res.json()) as { response?: T; errors?: unknown; results?: number };
  // L'API risponde 200 anche sugli errori applicativi, mettendoli in `errors`.
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    const first = Object.values(json.errors as Record<string, string>)[0];
    const message = String(first);
    return {
      data: null,
      error: message,
      calls: 1,
      rateLimited: /limit|quota/i.test(message),
    };
  }
  return { data: (json.response ?? null) as T | null, error: null, calls: 1, rateLimited: false };
}

type ApiPlayerSearchEntry = {
  player: {
    id: number;
    name: string;
    firstname?: string | null;
    lastname?: string | null;
    nationality: string | null;
    birth?: { date?: string | null } | null;
  };
  statistics?: { team?: { name?: string } }[];
};

const strip = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").trim();

/**
 * Trova l'id del giocatore su API-Football.
 *
 * Cerca prima dentro la Serie A della stagione indicata: tutti i giocatori del
 * nostro listone sono li', e la risposta porta la squadra, che permette di
 * distinguere gli omonimi. Solo se non lo trova ripiega sull'anagrafica globale,
 * e li' accetta soltanto una corrispondenza netta: fra un dato sbagliato e
 * nessun dato, nessun dato fa molti meno danni.
 */
export async function searchPlayer(
  cfg: ApiFootballConfig,
  name: string,
  team?: string,
  seasonHint?: number,
  opts: { term?: string; birthYear?: number | null } = {},
): Promise<ApiCallResult<{ id: number; name: string } | null>> {
  // La ricerca vuole almeno 4 caratteri. Se abbiamo il nome completo ricostruito
  // usiamo quello: "Goncalo" trova poche persone, "Ramos" ne trova centinaia.
  const term =
    opts.term ??
    name
      .split(/[\s.']+/)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0];
  if (!term || term.length < 4) {
    return {
      data: null,
      error: `Nome troppo corto per la ricerca: "${name}".`,
      calls: 0,
      rateLimited: false,
    };
  }

  const wanted = strip(name);
  const wantedTeam = team ? strip(team) : null;
  let calls = 0;

  if (seasonHint) {
    const inSerieA = await call<ApiPlayerSearchEntry[]>(cfg, "/players", {
      search: term,
      league: SERIE_A_LEAGUE_ID,
      season: seasonHint,
    });
    calls += inSerieA.calls;
    if (inSerieA.rateLimited) {
      return { data: null, error: inSerieA.error, calls, rateLimited: true };
    }
    const list = inSerieA.data ?? [];
    const sameTeam = wantedTeam
      ? list.find((e) =>
          (e.statistics ?? []).some((st) => {
            const t = strip(st.team?.name ?? "");
            return t && (t === wantedTeam || t.includes(wantedTeam) || wantedTeam.includes(t));
          }),
        )
      : undefined;
    const hit = sameTeam ?? (list.length === 1 ? list[0] : undefined);
    if (hit) {
      return { data: { id: hit.player.id, name: hit.player.name }, error: null, calls, rateLimited: false };
    }
  }

  const profiles = await call<ApiPlayerSearchEntry[]>(cfg, "/players/profiles", { search: term });
  calls += profiles.calls;
  if (profiles.rateLimited) {
    return { data: null, error: profiles.error, calls, rateLimited: true };
  }
  let list = profiles.data ?? [];

  // L'anno di nascita e' il filtro piu' efficace fra omonimi: due calciatori con
  // lo stesso nome nati lo stesso anno sono rari.
  if (opts.birthYear && list.length > 1) {
    const sameYear = list.filter(
      (e) => e.player.birth?.date?.slice(0, 4) === String(opts.birthYear),
    );
    if (sameYear.length > 0) list = sameYear;
  }

  // Il nome completo ricostruito, se ce l'abbiamo, e' piu' selettivo di quello
  // abbreviato del listone.
  const fullWanted = opts.term ? strip(opts.term) : null;
  if (fullWanted && list.length > 1) {
    const byFull = list.filter((e) => {
      const composed = strip(`${e.player.firstname ?? ""} ${e.player.lastname ?? ""}`);
      return composed.includes(fullWanted) || strip(e.player.name).includes(fullWanted);
    });
    if (byFull.length > 0) list = byFull;
  }

  const exact = list.filter((e) => strip(e.player.name) === wanted);
  if (exact.length === 1) {
    return {
      data: { id: exact[0].player.id, name: exact[0].player.name },
      error: null,
      calls,
      rateLimited: false,
    };
  }
  if (list.length === 1) {
    return {
      data: { id: list[0].player.id, name: list[0].player.name },
      error: null,
      calls,
      rateLimited: false,
    };
  }
  return {
    data: null,
    error:
      list.length > 1
        ? `"${name}": ${list.length} omonimi, nessuno identificabile con certezza.`
        : `Nessun giocatore trovato per "${name}".`,
    calls,
    rateLimited: false,
  };
}

type ApiStatEntry = {
  team?: { name?: string };
  league?: { name?: string; country?: string; season?: number };
  games?: { appearences?: number | null; lineups?: number | null; minutes?: number | null; rating?: string | null };
  goals?: { total?: number | null; conceded?: number | null; assists?: number | null };
  cards?: { yellow?: number | null; red?: number | null; yellowred?: number | null };
  penalty?: { scored?: number | null; missed?: number | null; saved?: number | null };
};
type ApiPlayerSeason = { player: { id: number; name: string }; statistics: ApiStatEntry[] };

export type ExternalSeasonStats = Omit<PlayerStatsRow, "player_id"> & {
  competitionLabel: string;
};

/** Da "2025" alla nostra "2025-26". */
export function apiSeasonToLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

const n = (v: number | null | undefined) => Number(v ?? 0);

/**
 * Statistiche di un giocatore per una stagione, una riga per competizione.
 * Costa una chiamata: la risposta contiene gia' campionato e coppe.
 */
export async function fetchPlayerSeason(
  cfg: ApiFootballConfig,
  apiPlayerId: number,
  year: number,
  role: Role,
): Promise<ApiCallResult<ExternalSeasonStats[]>> {
  const res = await call<ApiPlayerSeason[]>(cfg, "/players", { id: apiPlayerId, season: year });
  if (res.error) return { ...res, data: null };

  const entry = (res.data ?? [])[0];
  if (!entry) return { data: [], error: null, calls: res.calls, rateLimited: false };

  const out: ExternalSeasonStats[] = [];
  for (const st of entry.statistics ?? []) {
    const apps = n(st.games?.appearences);
    if (apps <= 0) continue;
    const leagueName = st.league?.name ?? "";
    const leagueCountry = st.league?.country ?? undefined;
    if (shouldSkipCompetition(leagueName, leagueCountry)) continue;
    const comp = resolveCompetition(leagueName, leagueCountry);
    const rating = st.games?.rating ? Number(st.games.rating) : null;
    out.push({
      season: apiSeasonToLabel(year),
      competition: comp.key,
      // La squadra c'era da sempre nella risposta e nessuno la leggeva.
      club: st.team?.name ?? "",
      competitionLabel: `${comp.label}${comp.country !== "Italia" && comp.country !== "Europa" ? ` (${comp.country})` : ""}`,
      source: "api",
      rating: Number.isFinite(rating) ? rating : null,
      matches: apps,
      minutes: n(st.games?.minutes) || null,
      // Fuori dalla Serie A la media voto italiana non esiste: la ricostruisce
      // il convertitore partendo dal rating.
      avg_vote: comp.key === SERIE_A_KEY ? null : null,
      avg_fantavote: null,
      goals: n(st.goals?.total),
      assists: n(st.goals?.assists),
      own_goals: 0,
      yellow_cards: n(st.cards?.yellow) + n(st.cards?.yellowred),
      red_cards: n(st.cards?.red) + n(st.cards?.yellowred),
      pen_scored: n(st.penalty?.scored),
      pen_missed: n(st.penalty?.missed),
      pen_saved: n(st.penalty?.saved),
      goals_conceded: role === "P" ? n(st.goals?.conceded) : 0,
      clean_sheets: 0,
    });
  }
  return { data: out, error: null, calls: res.calls, rateLimited: false };
}

/** Chiamata minima per verificare che la chiave funzioni. */
export async function ping(cfg: ApiFootballConfig): Promise<ApiCallResult<unknown>> {
  return call(cfg, "/status", {});
}

/**
 * Percorsi che la sonda puo' interrogare.
 *
 * La documentazione di API-Football risponde 403 a chi non ha un browser, e
 * indovinare la forma di una risposta e' il modo migliore per scrivere un
 * abbinamento che funziona sui dati immaginati. La sonda chiede all'API vera e
 * riporta cosa torna davvero — una chiamata su cento, spesa una volta.
 *
 * L'elenco e' chiuso: e' un endpoint amministrativo che parla verso l'esterno,
 * e non deve poter chiamare un percorso arbitrario.
 */
/** Una partita saltata da un giocatore, con il motivo che dice la fonte. */
export type Assenza = {
  apiId: number;
  /** "Missing Fixture" = l'ha saltata davvero; "Questionable" = era in dubbio. */
  saltata: boolean;
  motivo: string;
};

/**
 * Le assenze di un'intera stagione, in una chiamata sola.
 *
 * L'archivio tiene una riga per giocatore e per partita saltata: tremila righe
 * per una stagione di Serie A, e le manda tutte insieme senza paginare. E' il
 * dato piu' economico che abbiamo mai preso — e l'unico che distingue "non ha
 * giocato perche' era rotto" da "non ha giocato perche' l'allenatore ha scelto
 * un altro", che dai conteggi delle presenze non si vede.
 */
export async function fetchAssenzeStagione(
  cfg: ApiFootballConfig,
  season: number,
): Promise<ApiCallResult<Assenza[]>> {
  type Riga = { player?: { id?: number; type?: string | null; reason?: string | null } };
  const res = await call<Riga[]>(cfg, "/injuries", {
    league: SERIE_A_LEAGUE_ID,
    season,
  });
  if (res.error || !res.data) {
    return { data: null, error: res.error, calls: res.calls, rateLimited: res.rateLimited };
  }

  const out: Assenza[] = [];
  for (const r of res.data) {
    const id = r.player?.id;
    if (typeof id !== "number") continue;
    out.push({
      apiId: id,
      saltata: (r.player?.type ?? "").toLowerCase().includes("missing"),
      motivo: (r.player?.reason ?? "").trim(),
    });
  }
  return { data: out, error: null, calls: 1, rateLimited: false };
}

export const PROBE_PATHS = [
  "/teams",
  "/players",
  "/players/squads",
  "/players/profiles",
  "/injuries",
  "/leagues",
] as const;

export type ProbePath = (typeof PROBE_PATHS)[number];

/** Chiede un percorso e riporta cosa torna, senza interpretarlo. */
export async function probe(
  cfg: ApiFootballConfig,
  path: ProbePath,
  params: Record<string, string | number>,
): Promise<{ raw: unknown; error: string | null; calls: number }> {
  const url = new URL(`${baseUrl(cfg)}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, { headers: headers(cfg) });
    const json = await res.json();
    return { raw: json, error: res.ok ? null : `HTTP ${res.status}`, calls: 1 };
  } catch (e) {
    return { raw: null, error: (e as Error).message, calls: 1 };
  }
}

type ApiLeagueEntry = {
  seasons?: { year: number; coverage?: { players?: boolean } }[];
};

/**
 * Quali stagioni il piano espone davvero con le statistiche dei giocatori.
 *
 * Il piano gratuito non copre necessariamente l'ultima annata: chiederla
 * significherebbe bruciare chiamate per ricevere risposte vuote. Costa una
 * chiamata, la si fa una volta per lotto.
 */
export async function availableSeasons(cfg: ApiFootballConfig): Promise<ApiCallResult<number[]>> {
  const res = await call<ApiLeagueEntry[]>(cfg, "/leagues", { id: SERIE_A_LEAGUE_ID });
  if (res.error) return { ...res, data: null };
  const seasons = (res.data?.[0]?.seasons ?? [])
    .filter((s) => s.coverage?.players !== false)
    .map((s) => s.year)
    .sort((a, b) => b - a);
  return { data: seasons, error: null, calls: res.calls, rateLimited: false };
}

type ApiTeamEntry = { team?: { id?: number; name?: string } };

/**
 * L'id di una squadra, cercandola per nome.
 *
 * Non per campionato e stagione, che sarebbe la strada ovvia: **il piano
 * gratuito non serve la stagione in corso** e risponde "Free plans do not have
 * access to this season, try from 2022 to 2024". Chiedere le squadre della
 * Serie A 2024-25 darebbe venti club che non sono i nostri — nel frattempo tre
 * sono retrocesse e tre salite.
 *
 * La ricerca per nome invece non ha stagione, e gli id delle squadre non
 * cambiano da un anno all'altro: e' l'unico modo di arrivare alle rose di
 * adesso con un piano che si ferma al 2024.
 */
/**
 * Se il nome e' quello di una squadra femminile.
 *
 * L'archivio le distingue con una "W" finale — "Roma W", "Juventus Women" — e
 * non con un campo: senza questo controllo il listone maschile finisce
 * abbinato alla rosa sbagliata, e i giocatori risultano tutti fuori rosa.
 */
export function isFemminile(nome: string): boolean {
  return /\bW$/i.test(nome.trim()) || /\b(women|femminile|femminil)/i.test(nome);
}

export async function fetchTeamByName(
  cfg: ApiFootballConfig,
  nome: string,
): Promise<ApiCallResult<{ id: number; name: string } | null>> {
  const res = await call<(ApiTeamEntry & { team?: { country?: string; national?: boolean } })[]>(
    cfg,
    "/teams",
    { search: nome },
  );
  if (res.error) return { ...res, data: null };

  // La ricerca restituisce anche nazionali, squadre omonime di altri paesi e —
  // la trappola vera — le squadre femminili, che l'archivio distingue solo con
  // una "W" in coda al nome. Cercando "Roma" il club maschile si chiama "AS
  // Roma", quindi la corrispondenza esatta falliva e il criterio "vince il nome
  // piu' corto" premiava "Roma W": ventitre giocatori della Roma risultavano
  // fuori rosa perche' li cercavamo nella squadra sbagliata.
  const candidati = (res.data ?? [])
    .map((e) => e.team)
    .filter(
      (t): t is { id: number; name: string; country?: string; national?: boolean } =>
        !!t &&
        Number(t.id) > 0 &&
        t.country === "Italy" &&
        t.national !== true &&
        !isFemminile(String(t.name ?? "")),
    );
  if (candidati.length === 0) {
    return { data: null, error: `Nessun club italiano per "${nome}".`, calls: res.calls, rateLimited: false };
  }
  // Poi il nome piu' vicino, per punteggio e non per lunghezza. Cercando "Roma"
  // tornano "AS Roma", "Roma W" e "Romana": tutte contengono "roma", e sceglierne
  // una per lunghezza del nome ha portato prima alla squadra femminile e poi a
  // un club minore. Tolto il contorno societario, "AS Roma" e' *uguale* a
  // "Roma"; "Romana" solo ci somiglia.
  const ordinati = candidati
    .map((t) => ({ t, punti: punteggioSquadra(nome, String(t.name)) }))
    .filter((x) => x.punti > 0)
    .sort((a, b) => b.punti - a.punti || a.t.name.length - b.t.name.length);
  if (ordinati.length === 0) {
    return {
      data: null,
      error: `Nessun club italiano somigliante a "${nome}".`,
      calls: res.calls,
      rateLimited: false,
    };
  }
  const scelto = ordinati[0].t;
  return {
    data: { id: Number(scelto.id), name: String(scelto.name) },
    error: null,
    calls: res.calls,
    rateLimited: false,
  };
}

type ApiSquadEntry = {
  players?: {
    id?: number;
    name?: string | null;
    firstname?: string | null;
    lastname?: string | null;
    number?: number | null;
    position?: string | null;
  }[];
};

/**
 * La rosa attuale di una squadra, in una chiamata.
 *
 * Non prende la stagione, e per noi e' il punto: restituisce chi c'e' **adesso**,
 * quindi comprende i nuovi arrivi — che sono esattamente i giocatori che non
 * riusciamo a identificare. Ogni endpoint legato alla stagione o non li ha
 * ancora, o li mette ancora nella squadra da cui sono partiti.
 */
export async function fetchSquad(
  cfg: ApiFootballConfig,
  teamId: number,
): Promise<
  ApiCallResult<
    {
      apiId: number;
      name?: string | null;
      firstname?: string | null;
      lastname?: string | null;
      position?: string | null;
    }[]
  >
> {
  const res = await call<ApiSquadEntry[]>(cfg, "/players/squads", { team: teamId });
  if (res.error) return { ...res, data: null };
  const rosa = (res.data ?? [])[0]?.players ?? [];
  return {
    data: rosa
      .filter((p) => Number(p.id ?? 0) > 0)
      .map((p) => ({
        apiId: Number(p.id),
        name: p.name ?? null,
        firstname: p.firstname ?? null,
        lastname: p.lastname ?? null,
        position: p.position ?? null,
      })),
    error: null,
    calls: res.calls,
    rateLimited: false,
  };
}

export type VoceStagione = {
  apiId: number;
  fullName: string | null;
  birthYear: number | null;
  /** Una riga per competizione: campionato, coppa nazionale, coppe europee. */
  competizioni: ExternalSeasonStats[];
  /** Partite iniziate da titolare nel campionato. */
  lineups: number | null;
};

/**
 * Una pagina di giocatori di una **squadra** in una stagione.
 *
 * Per squadra e non per campionato, e la ragione e' una misura: il piano
 * gratuito accetta al massimo tre pagine — "Free plans are limited to a maximum
 * value of 3 for the Page parameter" — quindi chiedere il campionato intero
 * restituisce sessanta giocatori su mille e si ferma. Una rosa invece sta in due
 * pagine, e venti squadre coprono il campionato in una quarantina di chiamate.
 *
 * Porta tre campi che i file ufficiali di Fantacalcio.it non hanno affatto: i
 * **minuti**, il **rating**, e le partite **da titolare** — che e' la differenza
 * fra un titolare e una riserva con le stesse presenze.
 */
export async function fetchTeamSeasonPage(
  cfg: ApiFootballConfig,
  teamId: number,
  season: number,
  page: number,
): Promise<ApiCallResult<{ voci: VoceStagione[]; pagine: number }>> {
  const url = new URL(`${baseUrl(cfg)}/players`);
  url.searchParams.set("team", String(teamId));
  url.searchParams.set("season", String(season));
  url.searchParams.set("page", String(page));

  let res: Response;
  try {
    res = await fetch(url, { headers: headers(cfg) });
  } catch (e) {
    return { data: null, error: `Rete non raggiungibile: ${(e as Error).message}`, calls: 1, rateLimited: false };
  }
  if (res.status === 429) {
    return { data: null, error: "Limite di chiamate esaurito.", calls: 1, rateLimited: true };
  }
  if (!res.ok) {
    return { data: null, error: `API-Football ha risposto ${res.status}.`, calls: 1, rateLimited: false };
  }
  const json = (await res.json()) as {
    response?: (ApiPlayerSeason & {
      player: { firstname?: string | null; lastname?: string | null; birth?: { date?: string | null } };
    })[];
    paging?: { total?: number };
    errors?: unknown;
  };
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length > 0) {
    const messaggio = String(Object.values(json.errors as Record<string, string>)[0]);
    return { data: null, error: messaggio, calls: 1, rateLimited: /limit|quota/i.test(messaggio) };
  }

  const voci: VoceStagione[] = [];
  for (const entry of json.response ?? []) {
    const apiId = Number(entry.player?.id ?? 0);
    if (!apiId) continue;
    const nome = [entry.player.firstname, entry.player.lastname].filter(Boolean).join(" ").trim();
    const nascita = entry.player.birth?.date ?? "";
    let lineups: number | null = null;

    const competizioni: ExternalSeasonStats[] = [];
    for (const st of entry.statistics ?? []) {
      const apps = n(st.games?.appearences);
      if (apps <= 0) continue;
      const leagueName = st.league?.name ?? "";
      const leagueCountry = st.league?.country ?? undefined;
      if (shouldSkipCompetition(leagueName, leagueCountry)) continue;
      const comp = resolveCompetition(leagueName, leagueCountry);
      if (comp.key === SERIE_A_KEY) lineups = n((st.games as { lineups?: number | null })?.lineups);
      const rating = st.games?.rating ? Number(st.games.rating) : null;
      competizioni.push({
        season: apiSeasonToLabel(season),
        competition: comp.key,
        club: st.team?.name ?? "",
        competitionLabel: comp.label,
        source: "api",
        rating: Number.isFinite(rating) ? rating : null,
        matches: apps,
        minutes: n(st.games?.minutes) || null,
        avg_vote: null,
        avg_fantavote: null,
        goals: n(st.goals?.total),
        assists: n(st.goals?.assists),
        own_goals: 0,
        yellow_cards: n(st.cards?.yellow) + n(st.cards?.yellowred),
        red_cards: n(st.cards?.red) + n(st.cards?.yellowred),
        pen_scored: n(st.penalty?.scored),
        pen_missed: n(st.penalty?.missed),
        pen_saved: n(st.penalty?.saved),
        // I gol subiti hanno senso solo per i portieri: il ruolo lo sa il
        // chiamante, che li azzera dove non servono.
        goals_conceded: n(st.goals?.conceded),
        clean_sheets: 0,
      });
    }

    voci.push({
      apiId,
      fullName: nome || null,
      birthYear: /^\d{4}/.test(nascita) ? Number(nascita.slice(0, 4)) : null,
      competizioni,
      lineups,
    });
  }
  return {
    data: { voci, pagine: Number(json.paging?.total ?? 1) },
    error: null,
    calls: 1,
    rateLimited: false,
  };
}
