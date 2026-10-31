import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  apiFootballConfig,
  fetchTeamSeasonPage,
  type VoceStagione,
} from "@/lib/fanta/apiFootball";
import { budgetOra, dopoLaCorsa, readApiMemory, writeApiMemory } from "@/lib/apiState";
import { canOverwrite } from "@/lib/fanta/reliability";
import { separaIncoerenti } from "@/lib/fanta/coherence";
import { mergeDuplicates, statKey, type StatRow } from "@/lib/fanta/externalStats";
import type { Role } from "@/lib/fanta/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * I campi che i file ufficiali non hanno, per tutto il campionato in una volta.
 *
 * I file di Fantacalcio.it non riportano i **minuti giocati** — su nessuna delle
 * 1592 righe importate — ne' il rating, ne' le partite **da titolare**. Sono
 * esattamente i tre campi che distinguono un titolare da una riserva con lo
 * stesso numero di presenze, cioe' la differenza che all'asta si paga.
 *
 * Chiederli un giocatore per volta costerebbe cinquecento chiamate, cinque
 * giorni di quota. L'endpoint paginato del campionato ne restituisce venti a
 * pagina: la Serie A intera sta in una cinquantina di chiamate.
 *
 * L'abbinamento non usa i nomi: passa dall'id dell'archivio, che la spazzata
 * delle rose ha gia' messo su 467 giocatori. Un abbinamento per id non puo'
 * sbagliare persona.
 */

const STATE_KEY = "seasonStats";

type SweepState = {
  season: number | null;
  /** Le squadre gia' finite: la spazzata riprende da quelle che mancano. */
  fatte: number[];
  aggiornata: string | null;
};

const VUOTO: SweepState = { season: null, fatte: [], aggiornata: null };

/**
 * Quante pagine chiedere per squadra.
 *
 * Il piano gratuito ne accetta tre — "Free plans are limited to a maximum value
 * of 3 for the Page parameter" — e una rosa da trenta ne riempie due. Chiedere
 * la terza costa una chiamata per scoprire che era vuota, quindi ci si ferma
 * quando la pagina torna corta.
 */
const PAGINE_MAX = 3;

type Supabase = Awaited<ReturnType<typeof createClient>>;

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
    return { error: NextResponse.json({ error: "Serve un amministratore." }, { status: 403 }) };
  }
  return { supabase };
}

async function readState(supabase: Supabase, season: number): Promise<SweepState> {
  const { data } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", `${STATE_KEY}:${season}`)
    .maybeSingle();
  return { ...VUOTO, season, ...((data?.value ?? {}) as Partial<SweepState>) };
}

async function writeState(supabase: Supabase, state: SweepState) {
  await supabase.from("app_state").upsert(
    {
      key: `${STATE_KEY}:${state.season}`,
      value: { ...state, aggiornata: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;
  const season = Number(new URL(request.url).searchParams.get("season") ?? 2024);
  const [state, memoria] = await Promise.all([readState(supabase, season), readApiMemory(supabase)]);
  return NextResponse.json({ ...state, quotaOggi: memoria.callsToday, budgetOra: budgetOra(memoria) });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;

  const body = await request.json().catch(() => ({}));
  // Il piano gratuito copre dal 2022 al 2024: oltre risponde che la stagione
  // non e' inclusa, e la chiamata e' persa.
  const season = Math.min(2024, Math.max(2022, Number(body.season) || 2024));
  const ricomincia = body.restart === true;

  const cfg = apiFootballConfig();
  if (!cfg) return NextResponse.json({ error: "APIFOOTBALL_KEY non configurata." }, { status: 503 });

  let memoria = await readApiMemory(supabase);
  let state = ricomincia ? { ...VUOTO, season } : await readState(supabase, season);
  const budget = budgetOra(memoria);
  if (budget <= 0) {
    return NextResponse.json({
      season,
      fatte: state.fatte.length,
      calls: 0,
      done: false,
      messaggio:
        memoria.callsToday >= 100
          ? "Quota dell'archivio esaurita per oggi: si azzera a mezzanotte UTC."
          : "Limite al minuto: riprova fra un minuto.",
    });
  }

  // Gli id delle squadre li ha gia' trovati la spazzata delle rose: non si
  // ricercano, si riusano.
  const { data: rosters } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", "rosters")
    .maybeSingle();
  const squadre = (((rosters?.value ?? {}) as { squadre?: { id: number; listone: string }[] })
    .squadre ?? []) as { id: number; listone: string }[];
  if (squadre.length === 0) {
    return NextResponse.json(
      { error: "Nessuna squadra nota: lancia prima la spazzata delle rose." },
      { status: 409 },
    );
  }

  // Chi siamo capaci di riconoscere: l'id dell'archivio e' l'unica chiave che
  // non puo' sbagliare persona.
  const { data: identita } = await supabase
    .from("player_identities")
    .select("player_id, api_player_id, full_name, birth_year")
    .not("api_player_id", "is", null);
  type Identita = {
    player_id: string;
    api_player_id: number;
    full_name: string | null;
    birth_year: number | null;
  };
  const perApiId = new Map(
    ((identita ?? []) as Identita[]).map((i) => [i.api_player_id, i.player_id]),
  );
  // Chi non ha ancora il nome per esteso o l'anno di nascita. L'archivio li
  // manda insieme alle statistiche, nella stessa risposta che stiamo gia'
  // scaricando: non salvarli era buttare via roba gia' pagata.
  const senzaNome = new Set(
    ((identita ?? []) as Identita[]).filter((i) => !i.full_name).map((i) => i.player_id),
  );
  const senzaAnno = new Set(
    ((identita ?? []) as Identita[]).filter((i) => i.birth_year == null).map((i) => i.player_id),
  );
  const { data: giocatori } = await supabase
    .from("players")
    .select("id, role")
    .eq("is_active", true)
    .range(0, 999);
  const ruoli = new Map(((giocatori ?? []) as { id: string; role: Role }[]).map((p) => [p.id, p.role]));

  let calls = 0;
  let stopped: string | null = null;
  const avvisi: string[] = [];
  let nuove = 0;
  let arricchite = 0;
  let scartate = 0;
  let riconosciuti = 0;
  let nomi = 0;

  for (const squadra of squadre) {
    if (stopped || calls >= budget) break;
    if (state.fatte.includes(squadra.id)) continue;

    for (let page = 1; page <= PAGINE_MAX; page++) {
      if (stopped || calls >= budget) break;
      const pagina = await fetchTeamSeasonPage(cfg, squadra.id, season, page);
      calls += pagina.calls;
      if (pagina.rateLimited || pagina.error) {
        stopped = pagina.error;
        break;
      }
      const voci = pagina.data?.voci ?? [];
      const nostri = voci.filter((v) => perApiId.has(v.apiId));
      riconosciuti += nostri.length;
      if (nostri.length > 0) {
        const esito = await scrivi(supabase, nostri, perApiId, ruoli);
        nuove += esito.nuove;
        arricchite += esito.arricchite;
        scartate += esito.scartate;
        avvisi.push(...esito.avvisi);
        nomi += await scriviIdentita(supabase, nostri, perApiId, senzaNome, senzaAnno);
      }
      // Pagina corta o ultima: la squadra e' finita, e chiedere la prossima
      // costerebbe una chiamata per scoprire che era vuota.
      if (voci.length < 20 || page >= (pagina.data?.pagine ?? 1)) break;
    }
    if (!stopped) state = { ...state, fatte: [...state.fatte, squadra.id] };
  }

  memoria = dopoLaCorsa(memoria, calls, stopped);
  await Promise.all([writeApiMemory(supabase, memoria), writeState(supabase, state)]);

  return NextResponse.json({
    season,
    squadre: squadre.length,
    fatte: state.fatte.length,
    calls,
    quotaOggi: memoria.callsToday,
    riconosciuti,
    nomi,
    nuove,
    arricchite,
    scartate,
    done: state.fatte.length >= squadre.length,
    stopped,
    avvisi: avvisi.slice(0, 8),
  });
}

/**
 * Riempie i nomi per esteso e gli anni di nascita che mancano.
 *
 * L'archivio manda nome, cognome e data di nascita nella stessa risposta delle
 * statistiche: erano gia' pagati e finivano nel cestino. Servono a due cose che
 * si sentono subito — cercare un giocatore per nome di battesimo, che sul
 * listone non c'e', e agganciare il nome quando il banditore lo chiama a voce.
 *
 * Si riempiono **solo i campi vuoti**: quello che c'e' gia' viene da una fonte
 * che qualcuno ha scelto, e l'archivio non e' piu' affidabile di lei.
 */
async function scriviIdentita(
  supabase: Supabase,
  voci: VoceStagione[],
  perApiId: Map<number, string>,
  senzaNome: Set<string>,
  senzaAnno: Set<string>,
): Promise<number> {
  let scritti = 0;
  for (const v of voci) {
    const playerId = perApiId.get(v.apiId);
    if (!playerId) continue;
    const patch: Record<string, unknown> = {};
    if (v.fullName && senzaNome.has(playerId)) patch.full_name = v.fullName;
    if (v.birthYear != null && senzaAnno.has(playerId)) patch.birth_year = v.birthYear;
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase
      .from("player_identities")
      .update(patch)
      .eq("player_id", playerId);
    if (!error) {
      if (patch.full_name) senzaNome.delete(playerId);
      if (patch.birth_year) senzaAnno.delete(playerId);
      scritti++;
    }
  }
  return scritti;
}

/**
 * Scrive quello che l'archivio ha portato, senza mai sostituire i file
 * ufficiali.
 *
 * E' la distinzione che fa funzionare tutto: sulle righe che vengono dai tuoi
 * file **non si sovrascrive niente**, si riempiono solo i campi vuoti. Minuti,
 * rating e partite da titolare sono vuoti su tutte, quindi si guadagnano tre
 * colonne senza toccarne una.
 */
async function scrivi(
  supabase: Supabase,
  voci: VoceStagione[],
  perApiId: Map<number, string>,
  ruoli: Map<string, Role>,
) {
  const avvisi: string[] = [];
  type Riga = Record<string, unknown>;
  const candidate: Riga[] = [];

  for (const v of voci) {
    const playerId = perApiId.get(v.apiId)!;
    const role = ruoli.get(playerId) ?? "C";
    for (const c of v.competizioni) {
      candidate.push({
        player_id: playerId,
        season: c.season,
        competition: c.competition,
        source: "api",
        rating: c.rating,
        matches: Math.round(c.matches),
        minutes: c.minutes,
        avg_vote: null,
        avg_fantavote: null,
        goals: Math.round(c.goals),
        assists: Math.round(c.assists),
        own_goals: 0,
        yellow_cards: Math.round(c.yellow_cards),
        red_cards: Math.round(c.red_cards),
        pen_scored: Math.round(c.pen_scored),
        pen_missed: Math.round(c.pen_missed),
        pen_saved: role === "P" ? Math.round(c.pen_saved) : 0,
        goals_conceded: role === "P" ? Math.round(c.goals_conceded) : 0,
        clean_sheets: 0,
        lineups: c.competition === "serie-a" ? v.lineups : null,
        // Le presenze secondo *questa* fonte. La titolarita' e' un rapporto, e
        // un rapporto fra numeri di fonti diverse non significa niente: i file
        // ufficiali contano le partite con un voto, l'archivio le presenze, e
        // su Lautaro fanno 31 contro 32.
        lineups_matches: c.competition === "serie-a" ? Math.round(c.matches) : null,
        source_detail: { provider: "api-football", api_player_id: v.apiId, sweep: "campionato" },
      });
    }
  }

  // Due righe con la stessa chiave nello stesso comando: Postgres rifiuta
  // l'intera upsert con "ON CONFLICT DO UPDATE command cannot affect row a
  // second time". Succede perche' l'archivio puo' restituire due blocchi che
  // ricadono sulla stessa competizione — due coppe diverse che per noi sono
  // "coppa nazionale" — e le due meta' vanno sommate, non scartate.
  const fuse = mergeDuplicates(candidate as StatRow[]) as Riga[];
  const { buone, scartate } = separaIncoerenti(fuse, (r) => ruoli.get(String(r.player_id)) ?? "C");
  for (const s of scartate.slice(0, 3)) {
    avvisi.push(`riga scartata (${s.riga.season}): ${s.problemi.join("; ")}`);
  }
  if (buone.length === 0) return { nuove: 0, arricchite: 0, scartate: scartate.length, avvisi };

  // Cosa c'e' gia', con la fonte: decide chi puo' scrivere.
  const { data: esistenti } = await supabase
    .from("player_stats")
    .select("*")
    .in("player_id", [...new Set(buone.map((r) => String(r.player_id)))]);
  const gia = new Map(((esistenti ?? []) as Riga[]).map((r) => [statKey(r as StatRow), r]));

  const daSostituire: Riga[] = [];
  const daArricchire: Riga[] = [];
  for (const r of buone) {
    const e = gia.get(statKey(r as StatRow));
    if (!e || canOverwrite("api", e.source)) {
      daSostituire.push(r);
      continue;
    }
    // Comanda chi c'era. Si aggiungono solo i campi che mancano — e la riga
    // parte completa dai valori esistenti, perche' PostgREST azzera le colonne
    // che una riga non nomina quando le altre le nominano.
    const buchi: Riga = {};
    // `club` compresa: sulle righe che vengono dai file ufficiali la squadra di
    // quella stagione non c'e', e questa spazzata passa squadra per squadra —
    // e' l'unico posto che la sa.
    for (const campo of ["minutes", "rating", "lineups", "lineups_matches", "club"] as const) {
      const vuoto = e[campo] == null || e[campo] === "";
      if (vuoto && r[campo] != null && r[campo] !== "") buchi[campo] = r[campo];
    }
    if (Object.keys(buchi).length === 0) continue;
    // Senza `id`: metterlo a `undefined` non toglie la colonna, la manda a
    // null, e la chiave primaria non lo ammette. Si copia tutto tranne quella.
    const { id: _id, created_at: _creato, ...resto } = e as Riga & { id?: unknown; created_at?: unknown };
    void _id;
    void _creato;
    daArricchire.push({ ...resto, ...buchi });
  }

  // Anche fra i due gruppi la chiave deve comparire una volta sola.
  const unici = (righe: Riga[]) => {
    const per = new Map<string, Riga>();
    for (const r of righe) per.set(statKey(r as StatRow), r);
    return [...per.values()];
  };

  let nuove = 0;
  let arricchite = 0;
  if (daSostituire.length > 0) {
    const { error } = await supabase
      .from("player_stats")
      .upsert(unici(daSostituire), { onConflict: "player_id,season,competition,club" });
    if (error) avvisi.push(`Statistiche non salvate: ${error.message}`);
    else nuove = daSostituire.length;
  }
  if (daArricchire.length > 0) {
    const { error } = await supabase
      .from("player_stats")
      .upsert(unici(daArricchire), { onConflict: "player_id,season,competition,club" });
    if (error) avvisi.push(`Arricchimento non salvato: ${error.message}`);
    else arricchite = daArricchire.length;
  }
  return { nuove, arricchite, scartate: scartate.length, avvisi };
}
