/**
 * Chi resta da recuperare, e in che ordine.
 *
 * Sta qui e non nel pannello perche' la stessa domanda se la fanno in tre: il
 * pannello per dire a che punto siamo, la route per scegliere il prossimo lotto
 * da sola, lo script di misura per sapere su chi sta lavorando. Tre copie della
 * stessa condizione si sarebbero disallineate al primo ritocco, e il conto
 * mostrato a schermo avrebbe smesso di corrispondere al lavoro fatto davvero.
 */
import { SERIE_A_KEY } from "./competitions";

/**
 * Presenze sotto le quali una stagione non dice niente: mezza partita a fine
 * campionato non e' storico, e' rumore.
 */
const MIN_MATCHES_SERIE_A = 5;

export type CoverageInput = {
  quotation_current?: number | null;
  fvm?: number | null;
  history?: { season: string; competition?: string | null; matches: number }[] | null;
};

/**
 * Quanto sappiamo di un giocatore:
 * - `serie-a`  ha almeno una stagione conclusa nel nostro campionato: il motore
 *              lo valuta senza conversioni e non c'e' niente da recuperare;
 * - `estero`   ha numeri da altri campionati, gia' convertiti alla scala Serie A;
 * - `nessuna`  non abbiamo nulla: il motore puo' solo copiare la quotazione.
 */
export type Coverage = "serie-a" | "estero" | "nessuna";

export function coverageOf(p: CoverageInput, currentSeason: string): Coverage {
  const rows = p.history ?? [];
  const serieA = rows.some(
    (h) =>
      (h.competition ?? SERIE_A_KEY) === SERIE_A_KEY &&
      h.season !== currentSeason &&
      h.matches >= MIN_MATCHES_SERIE_A,
  );
  if (serieA) return "serie-a";
  const estero = rows.some(
    (h) => (h.competition ?? SERIE_A_KEY) !== SERIE_A_KEY && h.matches > 0,
  );
  return estero ? "estero" : "nessuna";
}

export const quotationOf = (p: CoverageInput) => Number(p.quotation_current ?? p.fvm ?? 0);

/**
 * I giocatori su cui il recupero ha ancora senso, dal piu' caro al meno caro.
 *
 * L'ordine non e' un dettaglio estetico: la quota giornaliera dell'archivio
 * sportivo copre una trentina di giocatori, quindi un recupero interrotto a
 * meta' deve aver gia' coperto quelli che possono cambiare l'esito dell'asta.
 * Una riserva da un credito recuperata al posto di un titolare non vale niente.
 */
export function toRecover<T extends CoverageInput>(players: T[], currentSeason: string): T[] {
  return players
    .filter((p) => coverageOf(p, currentSeason) === "nessuna")
    .sort((a, b) => quotationOf(b) - quotationOf(a));
}

/** Il conteggio che il pannello mostra: una riga sola, tre numeri coerenti. */
export function recoveryProgress(players: CoverageInput[], currentSeason: string) {
  let serieA = 0;
  let estero = 0;
  let nessuna = 0;
  for (const p of players) {
    const c = coverageOf(p, currentSeason);
    if (c === "serie-a") serieA += 1;
    else if (c === "estero") estero += 1;
    else nessuna += 1;
  }
  return {
    /** Chi non ha storico di Serie A: il totale su cui il recupero lavora. */
    daRecuperare: estero + nessuna,
    /** Di quelli, chi e' gia' stato coperto da una fonte esterna. */
    recuperati: estero,
    /** Di quelli, chi non ha ancora nulla. */
    alBuio: nessuna,
    conStoricoSerieA: serieA,
  };
}

// ---------------------------------------------------------------------------
// Lo stato del recupero e la scelta del prossimo lotto
// ---------------------------------------------------------------------------

/** Cosa e' successo l'ultima volta che una fonte ha cercato questo giocatore. */
export type RecoveryState = {
  player_id: string;
  api_attempts: number;
  api_outcome: "ok" | "non-trovato" | "errore" | null;
  ai_attempts: number;
  ai_outcome: "ok" | "non-trovato" | "errore" | null;
};

export type Channel = "api" | "ai";

/**
 * Quante volte insistere su una fonte che non trova un giocatore.
 *
 * Due: la prima puo' fallire perche' l'identita' non c'era ancora, la seconda
 * gira col nome completo. Alla terza si sta solo spendendo per riavere la stessa
 * risposta — e sono quasi sempre riserve da un credito che nessun archivio ha
 * mai visto giocare.
 */
export const MAX_TENTATIVI = 2;

export function exhausted(state: RecoveryState | undefined, channel: Channel): boolean {
  if (!state) return false;
  const attempts = channel === "api" ? state.api_attempts : state.ai_attempts;
  const outcome = channel === "api" ? state.api_outcome : state.ai_outcome;
  return outcome !== "ok" && attempts >= MAX_TENTATIVI;
}

/** Chi non ha piu' nessuna fonte da provare: il ciclo lo salta e lo dichiara. */
export function abandoned(state: RecoveryState | undefined): boolean {
  return exhausted(state, "api") && exhausted(state, "ai");
}

export type BatchPlan<T> = {
  /** Chi va all'archivio sportivo: i piu' quotati, quanti la quota ne consente. */
  api: T[];
  /** Tutti gli altri del lotto, all'AI. I due rami corrono insieme. */
  ai: T[];
  /** Quanti restano dopo questo lotto, esclusi quelli su cui si e' rinunciato. */
  remaining: number;
  /** Su quanti si e' rinunciato: nessuna fonte li conosce. */
  givenUp: number;
};

/**
 * Come dividere il prossimo lotto fra i due canali.
 *
 * I due colli di bottiglia sono diversi e indipendenti: l'archivio e' gratis ma
 * contingentato al minuto, l'AI e' illimitata ma si paga. Metterli in fila
 * significherebbe far durare il lotto quanto la somma dei due; divisi, il lotto
 * dura quanto il piu' lento. Nessun giocatore finisce in entrambi i rami: chi
 * l'archivio non trova passa all'AI al lotto successivo, con l'esito registrato,
 * invece di essere pagato due volte nello stesso giro.
 */
export function planBatch<T extends { id: string }>(args: {
  queue: T[];
  state: Map<string, RecoveryState>;
  /** Quanti giocatori lavorare in tutto in questo lotto. */
  size: number;
  /** Chiamate all'archivio ancora spendibili adesso. */
  apiCalls: number;
  /** Quante ne costa un giocatore: una ricerca piu' una per annata utile. */
  callsPerPlayer: number;
}): BatchPlan<T> {
  const { queue, state, size, apiCalls, callsPerPlayer } = args;

  const vivi = queue.filter((p) => !abandoned(state.get(p.id)));
  const givenUp = queue.length - vivi.length;

  const quantiApi =
    callsPerPlayer > 0 ? Math.max(0, Math.floor(apiCalls / callsPerPlayer)) : 0;

  const api: T[] = [];
  const ai: T[] = [];
  for (const p of vivi) {
    if (api.length + ai.length >= size) break;
    const s = state.get(p.id);
    // L'archivio ha la precedenza sui piu' quotati: e' la fonte migliore e non
    // costa denaro. Chi avanza va all'AI nello stesso lotto.
    if (api.length < quantiApi && !exhausted(s, "api")) api.push(p);
    else if (!exhausted(s, "ai")) ai.push(p);
  }

  return { api, ai, remaining: vivi.length, givenUp };
}

/**
 * Quanti giocatori chiedere per ogni chiamata di identificazione.
 *
 * Misurato: il prompt chiede fino a sei stagioni di carriera per giocatore, e
 * con piu' di sei giocatori la risposta sfonda il tetto di token e torna
 * troncata, cioe' illeggibile. Un lotto grande si fa con piu' chiamate in
 * parallelo, non con una chiamata piu' grande.
 */
export const IDENTIFY_CHUNK = 6;

/**
 * Quanti token lasciare a una chiamata di identificazione.
 *
 * Misurato sulle 42 identita' gia' in archivio: la risposta per un giocatore
 * pesa 760 caratteri in media e 1298 nel caso peggiore (sette stagioni di
 * carriera), cioe' circa 220 e 370 token. Con il vecchio tetto fisso di 2500 un
 * gruppo di sei con carriere lunghe arrivava a sfiorarlo e tornava tagliato a
 * meta': JSON illeggibile, sei giocatori persi, e la colpa data al modello.
 *
 * Cinquecentocinquanta a testa stanno mezzo passo sopra il caso peggiore, e i
 * token in uscita di un modello economico costano una frazione di quello che
 * costa la ricerca web: il margine e' gratis, il taglio no.
 */
export const identifyTokenBudget = (quanti: number) => 400 + quanti * 550;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Quali annate l'archivio serve davvero
// ---------------------------------------------------------------------------

/**
 * Cosa abbiamo imparato sulle annate dell'archivio sportivo.
 *
 * `declared` e' quello che l'API dichiara di coprire, `empty` quello che alla
 * prova non ha mai restituito niente. Sono due cose diverse: il piano gratuito
 * dichiara l'annata piu' recente e poi risponde vuoto, e chiederla ogni volta
 * spreca la meta' della quota per riavere zero righe.
 */
export type SeasonMemory = {
  declared: number[];
  empty: number[];
  updatedAt: string | null;
};

export const EMPTY_SEASON_MEMORY: SeasonMemory = { declared: [], empty: [], updatedAt: null };

/** Le annate da chiedere: dichiarate, mai concluse a vuoto, non quella in corso. */
export function usableSeasons(memory: SeasonMemory, currentYear: number, max = 2): number[] {
  return memory.declared
    .filter((y) => y < currentYear && !memory.empty.includes(y))
    .sort((a, b) => b - a)
    .slice(0, max);
}

/** Quante chiamate costa un giocatore all'archivio: la ricerca piu' le annate. */
export const apiCallsPerPlayer = (seasons: number[], hasApiId: boolean) =>
  (hasApiId ? 0 : 1) + seasons.length;

export type SeasonEvidence = { year: number; asked: number; withData: number };

/**
 * Aggiorna la memoria delle annate con quello che il lotto ha visto.
 *
 * Un'annata si dichiara muta **solo se e' arrivata una risposta vuota davvero**,
 * su abbastanza giocatori diversi. Prima non era cosi': i fallimenti da limite al
 * minuto contavano come annate vuote, e bastavano due errori 429 all'inizio di
 * un ciclo perche' l'annata venisse saltata per tutto il resto della corsa. Le
 * chiamate rifiutate non entrano qui: `asked` conta solo le risposte ricevute.
 */
export function learnSeasons(
  memory: SeasonMemory,
  evidence: SeasonEvidence[],
  minProve = 3,
): SeasonMemory {
  const empty = new Set(memory.empty);
  for (const e of evidence) {
    if (e.withData > 0) empty.delete(e.year);
    else if (e.asked >= minProve) empty.add(e.year);
  }
  return { ...memory, empty: [...empty].sort((a, b) => b - a) };
}
