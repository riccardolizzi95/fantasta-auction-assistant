import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiFootballConfig, fetchSquad, fetchTeamByName } from "@/lib/fanta/apiFootball";
import { abbinaRosa, stessaSquadra, type GiocatoreListone } from "@/lib/fanta/rosters";
import { canOverwrite } from "@/lib/fanta/reliability";
import {
  parseRoster,
  rosterQuery,
  soloClubPiuRecente,
  WIKIDATA_ENDPOINT,
  WIKIDATA_UA,
} from "@/lib/fanta/wikidata";
import {
  budgetOra,
  dopoLaCorsa,
  readApiMemory,
  writeApiMemory,
  type ApiMemory,
} from "@/lib/apiState";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Chi sono i giocatori del listone, presi dalle rose ufficiali.
 *
 * Finora l'identita' la chiedevamo al modello, e il banco ha misurato quanto
 * vale: su dieci giocatori difficili, nove ricevevano nomi diversi da
 * configurazioni diverse, tutte convinte di aver ragione. Il cognome lo
 * azzeccavano — ma quello ce lo dava gia' il listone — e il nome se lo
 * inventavano.
 *
 * Le rose ufficiali chiudono la questione: il listone dice "Ramos G." e dice il
 * Milan, la squadra e' certa, e dentro venticinque nomi un cognome piu'
 * l'iniziale identifica una persona sola. Venti chiamate per tutti e 533,
 * contro le circa centocinquanta che costava chiederlo al modello — e senza
 * inventare niente.
 */

/** Dove si tiene il punto della spazzata. */
const ROSTER_STATE_KEY = "rosters";

type Squadra = { id: number; name: string; listone: string | null };

type RosterState = {
  season: number | null;
  squadre: Squadra[];
  /** Gli id gia' spazzati: la spazzata riprende da dove si era fermata. */
  fatte: number[];
  /** Quando Wikidata e' passata l'ultima volta. Non consuma quota, ma non ha
   *  senso rifarla a ogni lotto: cambia con il mercato, non con i minuti. */
  wikidataIl: string | null;
  aggiornata: string | null;
};

const VUOTO: RosterState = {
  season: null,
  squadre: [],
  fatte: [],
  wikidataIl: null,
  aggiornata: null,
};

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

async function readState(supabase: Supabase): Promise<RosterState> {
  const { data } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", ROSTER_STATE_KEY)
    .maybeSingle();
  return { ...VUOTO, ...((data?.value ?? {}) as Partial<RosterState>) };
}

async function writeState(supabase: Supabase, state: RosterState) {
  await supabase.from("app_state").upsert(
    {
      key: ROSTER_STATE_KEY,
      value: { ...state, aggiornata: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

/** A che punto siamo, senza spendere una chiamata. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;
  const [state, memoria] = await Promise.all([readState(supabase), readApiMemory(supabase)]);
  return NextResponse.json({
    season: state.season,
    squadre: state.squadre.length,
    fatte: state.fatte.length,
    senzaCorrispondenza: state.squadre.filter((s) => !s.listone).map((s) => s.name),
    aggiornata: state.aggiornata,
    quotaOggi: memoria.callsToday,
    budgetOra: budgetOra(memoria),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;

  const body = await request.json().catch(() => ({}));
  const ricomincia = body.restart === true;

  const cfg = apiFootballConfig();
  if (!cfg) {
    return NextResponse.json({ error: "APIFOOTBALL_KEY non configurata." }, { status: 503 });
  }

  let memoria = await readApiMemory(supabase);
  let state = ricomincia ? { ...VUOTO } : await readState(supabase);
  const budget = budgetOra(memoria);

  // Il listone, con le squadre come le scrive Fantacalcio.it.
  const { data: listoneRaw } = await supabase
    .from("players")
    .select("id, name, team")
    .eq("is_active", true)
    .range(0, 999);
  const listone = (listoneRaw ?? []) as GiocatoreListone[];
  if (listone.length === 0) {
    return NextResponse.json({ error: "Listone vuoto: importa le quotazioni." }, { status: 404 });
  }

  let calls = 0;
  let stopped: string | null = null;
  const avvisi: string[] = [];

  // -------------------------------------------------------------------------
  // 0. Wikidata per prima, perche' non costa niente e non consuma quota.
  //    Tutto quello che copre lei e' lavoro che l'archivio non deve fare e che
  //    il modello non deve indovinare. Non e' una fonte migliore: e' una fonte
  //    gratuita, ed e' esattamente per questo che va provata per prima.
  // -------------------------------------------------------------------------
  let daWikidata = 0;
  const fonte: "auto" | "wikidata" | "api" =
    body.source === "wikidata" ? "wikidata" : body.source === "api" ? "api" : "auto";
  const rifaiWikidata =
    fonte !== "api" &&
    (ricomincia || !state.wikidataIl || Date.parse(state.wikidataIl) < Date.now() - 7 * 864e5);

  if (rifaiWikidata) {
    const esito = await passataWikidata(supabase, listone);
    daWikidata = esito.scritti;
    avvisi.push(...esito.avvisi);
    if (!esito.errore) state = { ...state, wikidataIl: new Date().toISOString() };
    else avvisi.push(`Wikidata non raggiungibile: ${esito.errore}`);
  }

  if (fonte === "wikidata" || budget <= 0) {
    await writeState(supabase, state);
    return NextResponse.json({
      fonte,
      daWikidata,
      squadre: state.squadre.length,
      fatte: state.fatte.length,
      calls: 0,
      // Con la sola Wikidata il lavoro e' finito; se e' la quota a mancare no,
      // ma la parte gratuita e' stata fatta lo stesso — che era il punto.
      done: fonte === "wikidata",
      messaggio:
        fonte === "wikidata"
          ? null
          : memoria.callsToday >= 100
            ? "Quota dell'archivio esaurita per oggi: si azzera a mezzanotte UTC. Wikidata ha lavorato lo stesso."
            : "Limite al minuto dell'archivio: riprova fra un minuto.",
      avvisi,
    });
  }

  // -------------------------------------------------------------------------
  // 1. Gli id delle squadre, cercandole per nome.
  //
  //    Non per campionato e stagione: il piano gratuito si ferma al 2024 e la
  //    Serie A di allora aveva tre squadre diverse dalle nostre. La ricerca per
  //    nome non ha stagione, e gli id non cambiano da un anno all'altro.
  //    Una chiamata per squadra, e poi si ricorda.
  // -------------------------------------------------------------------------
  const nomiListone = [...new Set(listone.map((p) => p.team))];
  if (state.squadre.length < nomiListone.length) {
    const gia = new Map(state.squadre.map((sq) => [sq.listone, sq]));
    for (const nome of nomiListone) {
      if (stopped || calls >= budget) break;
      if (gia.has(nome)) continue;
      const trovata = await fetchTeamByName(cfg, nome);
      calls += trovata.calls;
      if (trovata.rateLimited) {
        stopped = trovata.error;
        break;
      }
      if (!trovata.data) {
        avvisi.push(`${nome}: ${trovata.error ?? "non trovata nell'archivio"}`);
        continue;
      }
      gia.set(nome, { id: trovata.data.id, name: trovata.data.name, listone: nome });
    }
    state = { ...state, squadre: [...gia.values()] };
  }

  // -------------------------------------------------------------------------
  // 2. Le rose, una squadra per chiamata, finche' il minuto lo consente.
  // -------------------------------------------------------------------------
  const abbinati: {
    playerId: string;
    listone: string;
    id: string;
    fullName: string | null;
    come: string;
  }[] = [];
  const ambigui: { listone: string; candidati: string[] }[] = [];
  const mancanti: string[] = [];

  for (const squadra of state.squadre) {
    if (stopped || calls >= budget) break;
    if (state.fatte.includes(squadra.id)) continue;
    const rosa = await fetchSquad(cfg, squadra.id);
    calls += rosa.calls;
    if (rosa.rateLimited || rosa.error) {
      stopped = rosa.error;
      break;
    }

    const suoi = listone.filter((p) => p.team === squadra.listone);
    const esito = abbinaRosa(
      suoi,
      (rosa.data ?? []).map((v) => ({ ...v, id: String(v.apiId) })),
    );
    abbinati.push(...esito.trovati);
    ambigui.push(...esito.ambigui.map((a) => ({ listone: a.listone, candidati: a.candidati })));
    mancanti.push(...esito.mancanti.map((m) => m.listone));
    state = { ...state, fatte: [...state.fatte, squadra.id] };
  }

  // -------------------------------------------------------------------------
  // 3. Scrittura. L'id dell'archivio e' il dato che conta: e' quello che rende
  //    precise tutte le ricerche successive. Il nome per esteso si scrive solo
  //    se l'archivio ce l'ha davvero — quando abbrevia ("J. Stones") non si
  //    tocca quello che c'e' gia', perche' cancellare un nome buono con
  //    un'abbreviazione sarebbe una perdita, non un aggiornamento.
  // -------------------------------------------------------------------------
  let scritti = 0;
  if (abbinati.length > 0) {
    const righe = abbinati.map((a) => ({
      player_id: a.playerId,
      api_player_id: Number(a.id),
      source: "api",
      // Trovato dentro la rosa ufficiale della squadra che il listone dichiara:
      // non e' una stima, e dirlo evita che il modello lo rimetta in discussione.
      confidence: "alta",
      note: `abbinato alla rosa ufficiale per ${a.come}`,
      updated_at: new Date().toISOString(),
      ...(a.fullName ? { full_name: a.fullName } : {}),
    }));
    const { error } = await supabase
      .from("player_identities")
      .upsert(righe, { onConflict: "player_id" });
    if (error) avvisi.push(`Identita' non salvate: ${error.message}`);
    else scritti = righe.length;
  }

  memoria = dopoLaCorsa(memoria, calls, stopped) as ApiMemory;
  await Promise.all([writeApiMemory(supabase, memoria), writeState(supabase, state)]);

  const restanti = state.squadre.filter((s) => !state.fatte.includes(s.id)).length;
  return NextResponse.json({
    season: state.season,
    squadre: state.squadre.length,
    fatte: state.fatte.length,
    daWikidata,
    restanti,
    done: state.squadre.length > 0 && restanti === 0,
    calls,
    quotaOggi: memoria.callsToday,
    abbinati: abbinati.length,
    conNomeIntero: abbinati.filter((a) => a.fullName).length,
    scritti,
    ambigui,
    mancanti,
    stopped,
    avvisi,
  });
}

/**
 * La passata di Wikidata: una query per tutta la Serie A, e l'abbinamento al
 * listone squadra per squadra.
 *
 * Non consuma quota di nessuno, quindi non ha budget e non ha lotti: o riesce
 * tutta, o non riesce. Se Wikidata non risponde il resto del recupero prosegue
 * senza — e' un guadagno mancato, non un guasto.
 */
async function passataWikidata(supabase: Supabase, listone: GiocatoreListone[]) {
  const avvisi: string[] = [];
  let raw: unknown;
  try {
    const res = await fetch(
      `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(rosterQuery())}`,
      { headers: { Accept: "application/sparql-results+json", "User-Agent": WIKIDATA_UA } },
    );
    if (!res.ok) return { scritti: 0, avvisi, errore: `HTTP ${res.status}` };
    raw = await res.json();
  } catch (e) {
    return { scritti: 0, avvisi, errore: (e as Error).message };
  }

  const voci = soloClubPiuRecente(parseRoster(raw));
  if (voci.length === 0) return { scritti: 0, avvisi, errore: "nessun giocatore restituito" };

  const squadreListone = [...new Set(listone.map((p) => p.team))];
  const abbinati: {
    playerId: string;
    fullName: string;
    birthYear: number | null;
    nat: string | null;
    position: string | null;
    heightCm: number | null;
    externalIds: Record<string, string>;
  }[] = [];
  let senzaClub = 0;

  for (const squadra of squadreListone) {
    const rosa = voci.filter((v) => stessaSquadra(squadra, v.club));
    if (rosa.length === 0) {
      senzaClub += 1;
      continue;
    }
    const esito = abbinaRosa(
      listone.filter((p) => p.team === squadra),
      rosa.map((v) => ({ id: v.qid, name: v.fullName })),
    );
    for (const t of esito.trovati) {
      const v = rosa.find((x) => x.qid === t.id);
      if (!v) continue;
      abbinati.push({
        playerId: t.playerId,
        fullName: v.fullName,
        birthYear: v.birthYear,
        nat: v.nationality,
        position: v.position,
        heightCm: v.heightCm,
        externalIds: v.externalIds,
      });
    }
  }
  if (senzaClub > 0) {
    avvisi.push(`Wikidata non elenca ${senzaClub} squadre del listone.`);
  }
  if (abbinati.length === 0) return { scritti: 0, avvisi, errore: null };

  // La gerarchia vale anche qui: Wikidata sta sopra il modello e sotto
  // l'archivio, quindi corregge le invenzioni dell'AI ma non tocca un'identita'
  // gia' verificata.
  const { data: gia } = await supabase
    .from("player_identities")
    .select("player_id, source, full_name, birth_year, nationality, external_ids, position, height_cm")
    .in("player_id", abbinati.map((a) => a.playerId));
  const esistenti = new Map(
    ((gia ?? []) as { player_id: string; source: string }[]).map((r) => [r.player_id, r]),
  );

  // Tutte le righe con le stesse colonne, sempre.
  //
  // PostgREST, davanti a un elenco di oggetti con chiavi diverse, fa l'unione
  // delle colonne e mette a NULL quelle che mancano. Mandare insieme righe
  // "complete" e righe "solo i buchi" ha cancellato il nome a tre identita' che
  // l'archivio sportivo aveva verificato — cioe' esattamente il danno che la
  // gerarchia delle fonti doveva impedire, fatto dal meccanismo di scrittura
  // invece che dalla logica. Ogni riga parte da quello che c'e' gia'.
  const righe: Record<string, unknown>[] = [];
  let protette = 0;
  for (const a of abbinati) {
    const e = esistenti.get(a.playerId) as
      | {
          source: string;
          full_name: string | null;
          birth_year: number | null;
          nationality: string | null;
          external_ids: Record<string, string> | null;
          position: string | null;
          height_cm: number | null;
        }
      | undefined;
    if (e && !canOverwrite("wikidata", e.source)) {
      // Chi comanda ha gia' scritto: si riempiono solo i buchi.
      const buchi: Record<string, unknown> = {};
      if (e.birth_year == null && a.birthYear != null) buchi.birth_year = a.birthYear;
      if (e.nationality == null && a.nat) buchi.nationality = a.nat;
      if (!e.full_name && a.fullName) buchi.full_name = a.fullName;
      if (e.position == null && a.position) buchi.position = a.position;
      if (e.height_cm == null && a.heightCm != null) buchi.height_cm = a.heightCm;
      // Gli identificativi si uniscono sempre, anche sotto una fonte piu'
      // affidabile: sono indirizzi verso altri archivi, non affermazioni sul
      // giocatore, e averne uno in piu' non contraddice niente.
      const uniti = { ...((e.external_ids ?? {}) as Record<string, string>), ...a.externalIds };
      if (Object.keys(uniti).length > Object.keys(e.external_ids ?? {}).length) {
        buchi.external_ids = uniti;
      }
      if (Object.keys(buchi).length === 0) {
        protette += 1;
        continue;
      }
      // La fonte resta quella che c'era: qui stiamo riempiendo buchi, non
      // prendendo il posto di nessuno, e scriverci "wikidata" sopra
      // declasserebbe un'identita' verificata. Va indicata comunque perche' la
      // colonna non ammette il vuoto e l'upsert la pretende.
      righe.push({
        player_id: a.playerId,
        source: e.source,
        full_name: e.full_name,
        birth_year: e.birth_year,
        nationality: e.nationality,
        position: e.position,
        height_cm: e.height_cm,
        external_ids: e.external_ids ?? {},
        ...buchi,
        updated_at: new Date().toISOString(),
      });
      continue;
    }
    righe.push({
      player_id: a.playerId,
      full_name: a.fullName ?? e?.full_name ?? null,
      birth_year: a.birthYear ?? e?.birth_year ?? null,
      nationality: a.nat ?? e?.nationality ?? null,
      position: a.position ?? e?.position ?? null,
      height_cm: a.heightCm ?? e?.height_cm ?? null,
      external_ids: { ...((e?.external_ids ?? {}) as Record<string, string>), ...a.externalIds },
      source: "wikidata",
      // Un'enciclopedia con le fonti citate, abbinata dentro la rosa del club
      // che il listone dichiara: non e' una stima.
      confidence: "alta",
      note: "abbinato alla rosa di Wikidata",
      updated_at: new Date().toISOString(),
    });
  }

  if (righe.length === 0) return { scritti: 0, avvisi, errore: null };
  const { error } = await supabase
    .from("player_identities")
    .upsert(righe, { onConflict: "player_id" });
  if (error) {
    avvisi.push(`Identita' da Wikidata non salvate: ${error.message}`);
    return { scritti: 0, avvisi, errore: null };
  }
  const conId = abbinati.filter((a) => Object.keys(a.externalIds).length > 0).length;
  avvisi.push(
    `Wikidata: ${abbinati.length} abbinati su ${voci.length} voci, ` +
      `${conId} con almeno un identificativo esterno` +
      (protette > 0 ? `, ${protette} lasciati a una fonte piu' affidabile` : "") + ".",
  );
  return { scritti: righe.length, avvisi, errore: null };
}
