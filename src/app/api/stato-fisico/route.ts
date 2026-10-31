import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askOpenRouterJson } from "@/lib/fanta/openrouter";
import { indicizza, paroleDi, punteggio } from "@/lib/fanta/ricerca";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Chi e' infortunato adesso.
 *
 * E' l'unica cosa che questo software non puo' dedurre dai numeri: un giocatore
 * fermo da tre settimane ha esattamente le stesse statistiche di uno in forma, e
 * la differenza la sa solo chi ha letto il giornale stamattina. L'archivio
 * gratuito si ferma alla stagione 2024-25, quindi qui si chiede a un modello con
 * la ricerca sul web.
 *
 * **Una richiesta per squadra, non per giocatore.** La ricerca sul web si paga a
 * richiesta e non a risultato — $0.007 fissi — quindi chiedere "chi e'
 * indisponibile nella Roma" costa come chiedere di un singolo giocatore ma
 * copre venticinque nomi. Venti squadre fanno quattordici centesimi.
 *
 * Non entra nel prezzo, e non deve: e' la fonte meno affidabile che abbiamo.
 * Entra nelle note della scheda, con la data di quando e' stata presa, perche'
 * un'informazione di ieri sera su un infortunio vale e la stessa di tre
 * settimane fa e' peggio di niente.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const STATE_KEY = "statoFisico";
/** Quante squadre per chiamata: sotto i 60 secondi di Vercel con margine. */
const SQUADRE_PER_GIRO = 4;

type Stato = {
  /** Le squadre gia' fatte in questo giro. */
  fatte: string[];
  aggiornata: string | null;
  costo: number;
};

const VUOTO: Stato = { fatte: [], aggiornata: null, costo: 0 };

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

async function leggiStato(supabase: Supabase): Promise<Stato> {
  const { data } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", STATE_KEY)
    .maybeSingle();
  return { ...VUOTO, ...((data?.value ?? {}) as Partial<Stato>) };
}

async function scriviStato(supabase: Supabase, stato: Stato) {
  await supabase.from("app_state").upsert({ key: STATE_KEY, value: stato }, { onConflict: "key" });
}

type Voce = {
  nome?: string;
  stato?: string;
  rientro?: string | null;
  nota?: string | null;
  confidenza?: number | null;
};

const STATI = ["disponibile", "in dubbio", "infortunato", "squalificato"];

function normalizzaStato(s: string | undefined): string | null {
  const v = (s ?? "").toLowerCase().trim();
  if (STATI.includes(v)) return v;
  if (/dubbio|incert/.test(v)) return "in dubbio";
  if (/infort|lesion|oper|ko\b/.test(v)) return "infortunato";
  if (/squalific|diffid/.test(v)) return "squalificato";
  if (/disponib|abile|ok/.test(v)) return "disponibile";
  return null;
}

/**
 * La domanda, senza l'elenco dei giocatori.
 *
 * La prima versione allegava la rosa e chiedeva di segnare chi non stava bene:
 * il Como e' tornato con **tutta la squadra infortunata**, ognuno con la stessa
 * nota "non specificato", e il Cagliari con otto identici "infortunio al
 * ginocchio". Davanti a un elenco, un modello che non ha trovato niente lo
 * ricopia invece di dire che non ha trovato niente.
 *
 * Senza elenco la domanda e' aperta — "chi e' indisponibile nel Como?" — e la
 * risposta o contiene dei nomi veri o e' vuota. I nomi si agganciano dopo, alla
 * rosa, con la stessa ricerca che usa il campo dell'asta.
 */
function prompt(squadra: string, oggi: string): string {
  return [
    `Oggi e' ${oggi}. Cerca sul web le ultime notizie di formazione del ${squadra}, squadra di Serie A.`,
    "",
    "Voglio sapere quali suoi giocatori sono indisponibili in questi giorni: infortunati,",
    "in forte dubbio o squalificati. Cerca fonti recenti (ultimi dieci giorni).",
    "",
    'Rispondi con un JSON: {"giocatori": [{"nome": ..., "stato": ..., "rientro": ..., "nota": ..., "confidenza": ...}]}',
    "",
    "Regole:",
    "- `nome`: cognome e, se serve a distinguerlo, il nome. Come lo scrivono i giornali.",
    "- `stato`: solo uno fra infortunato, in dubbio, squalificato.",
    '- `rientro`: quando si prevede che torni, breve e in italiano (es. "fine settembre", "due settimane"). Se non si sa, null.',
    "- `nota`: il tipo di problema, in una riga di italiano. Se non sai qual e', **non mettere il giocatore**.",
    "- `confidenza`: da 0 a 1, quanto la notizia e' recente e verificata.",
    "",
    'Se non trovi notizie affidabili, rispondi {"giocatori": []}. Una lista vuota e\' una risposta',
    "corretta e utile; una lista inventata no. Non elencare mai piu' di sei o sette giocatori:",
    "una squadra non ha mezza rosa ferma.",
  ].join("\n");
}

/**
 * Quando una risposta non e' una notizia ma un elenco riempito.
 *
 * Tre segnali, tutti visti nella prima prova: mezza rosa segnata, la stessa nota
 * ripetuta su piu' giocatori, e note che dicono di non sapere. Basta uno per
 * buttare via la squadra intera — meglio nessun dato che un dato che fa
 * scartare mezzo Como all'asta.
 */
function sembraInventata(
  righe: { nota: string | null; confidenza: number | null }[],
  quantiInRosa: number,
): string | null {
  if (righe.length === 0) return null;
  if (righe.length > Math.max(7, quantiInRosa * 0.3)) {
    return `${righe.length} indisponibili su ${quantiInRosa}: non e' una notizia, e' l'elenco`;
  }
  const note = righe.map((r) => (r.nota ?? "").toLowerCase().trim());
  const ripetute = new Map<string, number>();
  for (const n of note) if (n) ripetute.set(n, (ripetute.get(n) ?? 0) + 1);
  const max = Math.max(0, ...ripetute.values());
  if (max >= 3) return `la stessa nota ripetuta ${max} volte: e' un modello, non una notizia`;
  return null;
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;
  const [stato, quanti] = await Promise.all([
    leggiStato(supabase),
    supabase.from("player_status").select("player_id", { count: "exact", head: true }),
  ]);
  const { data: squadre } = await supabase
    .from("players")
    .select("team")
    .eq("is_active", true);
  const totali = new Set((squadre ?? []).map((s) => (s as { team: string }).team)).size;
  return NextResponse.json({ ...stato, squadre: totali, conStato: quanti.count ?? 0 });
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;

  const body = await request.json().catch(() => ({}));
  const ricomincia = body.restart === true;

  const { data: giocatori } = await supabase
    .from("players")
    .select("id, name, team, player_identities(full_name)")
    .eq("is_active", true)
    .range(0, 999);
  type Riga = {
    id: string;
    name: string;
    team: string;
    player_identities: { full_name: string | null }[] | { full_name: string | null } | null;
  };
  const perSquadra = new Map<string, { id: string; name: string; fullName: string | null }[]>();
  for (const g of (giocatori ?? []) as Riga[]) {
    const ident = Array.isArray(g.player_identities) ? g.player_identities[0] : g.player_identities;
    perSquadra.set(g.team, [
      ...(perSquadra.get(g.team) ?? []),
      { id: g.id, name: g.name, fullName: ident?.full_name ?? null },
    ]);
  }

  let stato = ricomincia ? { ...VUOTO } : await leggiStato(supabase);
  const daFare = [...perSquadra.keys()].filter((s) => !stato.fatte.includes(s)).sort();
  const oggi = new Date().toISOString().slice(0, 10);

  const avvisi: string[] = [];
  let costo = 0;
  let trovati = 0;
  let squadreFatte = 0;

  for (const squadra of daFare.slice(0, SQUADRE_PER_GIRO)) {
    const rosa = perSquadra.get(squadra)!;
    const risposta = await askOpenRouterJson<{ giocatori?: Voce[] }>({
      prompt: prompt(squadra, oggi),
      web: true,
      webResults: 10,
      engine: "exa",
      maxTokens: 1200,
      temperature: 0,
    });
    costo += risposta.ok ? risposta.cost : risposta.cost;
    if (!risposta.ok) {
      avvisi.push(`${squadra}: ${risposta.error}`);
      continue;
    }

    // I nomi tornano come li scrivono i giornali: si agganciano alla rosa con
    // la stessa ricerca del campo dell'asta, che sa che "Nico Paz" e' "Paz N.".
    const indice = rosa.map((r) => ({
      id: r.id,
      idx: indicizza({ id: r.id, name: r.name, team: squadra, fullName: r.fullName }),
    }));
    const aggancia = (nome: string): string | null => {
      const parole = paroleDi(nome);
      if (parole.length === 0) return null;
      let miglior: { id: string; p: number } | null = null;
      for (const v of indice) {
        const p = punteggio(v.idx, parole);
        if (p > 0 && (!miglior || p > miglior.p)) miglior = { id: v.id, p };
      }
      return miglior && miglior.p >= 60 ? miglior.id : null;
    };

    const righe: Record<string, unknown>[] = [];
    for (const v of risposta.data.giocatori ?? []) {
      const id = aggancia(v.nome ?? "");
      const st = normalizzaStato(v.stato);
      // Un nome che non e' nella rosa e' un'invenzione o un altro giocatore:
      // in nessuno dei due casi lo vogliamo scrivere. E una nota che dice di
      // non sapere che problema abbia non e' una notizia.
      const nota = (v.nota ?? "").trim();
      const sicuro = typeof v.confidenza === "number" ? v.confidenza : 0;
      if (!id || !st || st === "disponibile") continue;
      if (!nota || /non specificat|sconosciut|non si sa|non chiaro/i.test(nota)) continue;
      if (sicuro < 0.6) continue;
      righe.push({
        player_id: id,
        stato: st,
        rientro: v.rientro ? String(v.rientro).slice(0, 80) : null,
        nota: v.nota ? String(v.nota).slice(0, 200) : null,
        confidenza: typeof v.confidenza === "number" ? Math.max(0, Math.min(1, v.confidenza)) : null,
        fonte: "ai",
        modello: risposta.model,
        aggiornato_al: new Date().toISOString(),
      });
    }
    const sospetta = sembraInventata(
      righe.map((r) => ({ nota: r.nota as string | null, confidenza: r.confidenza as number | null })),
      rosa.length,
    );
    if (sospetta) {
      avvisi.push(`${squadra}: scartata, ${sospetta}`);
      stato = { ...stato, fatte: [...stato.fatte, squadra] };
      squadreFatte++;
      continue;
    }

    if (righe.length > 0) {
      const { error } = await supabase
        .from("player_status")
        .upsert(righe, { onConflict: "player_id" });
      if (error) avvisi.push(`${squadra}: ${error.message}`);
      else trovati += righe.length;
    }
    // Chi era segnato indisponibile e adesso non compare piu' e' guarito: la
    // riga va tolta, altrimenti resta a spaventare per settimane.
    const ancora = new Set(righe.map((r) => r.player_id as string));
    const guariti = rosa.filter((r) => !ancora.has(r.id)).map((r) => r.id);
    if (guariti.length > 0) {
      await supabase.from("player_status").delete().in("player_id", guariti);
    }

    stato = { ...stato, fatte: [...stato.fatte, squadra] };
    squadreFatte++;
  }

  stato = { ...stato, aggiornata: new Date().toISOString(), costo: stato.costo + costo };
  await scriviStato(supabase, stato);

  return NextResponse.json({
    squadreFatte,
    fatte: stato.fatte.length,
    squadre: perSquadra.size,
    done: stato.fatte.length >= perSquadra.size,
    trovati,
    costo: Math.round(costo * 10000) / 10000,
    costoTotale: Math.round(stato.costo * 10000) / 10000,
    avvisi: avvisi.slice(0, 6),
  });
}
