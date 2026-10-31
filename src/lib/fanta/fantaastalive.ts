import { SERIE_A_KEY } from "./competitions";
import type { ParticipantRow, PlayerWithStats, Role } from "./types";

/**
 * Parlare la lingua di FantaAstaLive.
 *
 * FantaAstaLive e' il tabellone d'asta di Fantacalcio.it: bello da proiettare,
 * ma chiuso — nessuna API, nessun webhook. Due porte pero' ce le ha, e sono
 * file: la **lista calciatori personalizzata** e le **rose**. Tutte e due CSV,
 * tutte e due senza intestazione, tutte e due con le colonne a posizione fissa.
 *
 * Le forme qui sotto non sono indovinate: sono lette nel codice che gira sul
 * loro sito (bundle del 11/09/2026, `chunk-ASZNHTEF.js` per la lista calciatori
 * e `chunk-QQVPDJ2F.js` per le rose). `scripts/fantaastalive-check.ts` rilegge
 * i nostri file con una trascrizione dei loro parser, cosi' se cambiano formato
 * il controllo se ne accorge prima dell'asta.
 *
 * **Il file che serve e' .csv, non .xlsx**: il loro selettore accetta solo
 * `.csv` e legge il file come testo UTF-8. Un foglio Excel rinominato non viene
 * letto, e questo e' il motivo per cui i file ufficiali non si caricano.
 */

/** Serie A nel loro elenco di campionati (8 Premier, 22 Bundes, 23 Liga, 24 Ligue 1). */
const CAMPIONATO_SERIE_A = 21;

/** La carta del giocatore sul loro CDN: l'identificativo e' lo stesso del listone. */
const CARTA = "https://content.fantacalcio.it/web/campioncini/21/card/";

/**
 * Il ruolo mantra quando il listone non lo dice.
 *
 * Di norma lo dice: il file ufficiale ha la colonna RM e noi la conserviamo in
 * `role_mantra`, nella stessa forma che vuole FantaAstaLive ("M", "Dc", "W").
 * Questo e' il ripiego per le righe vecchie, e vale solo a ordinare dentro il
 * reparto: in una lega classic non sposta niente.
 */
const MANTRA_DA_RUOLO: Record<Role, string> = { P: "Por", D: "Dc", C: "C", A: "Pc" };

/**
 * Una cella non puo' contenere virgole.
 *
 * Il loro parser spezza la riga con `split(",")` e basta: niente virgolette,
 * niente escape. Una virgola nel nome sposta tutte le colonne successive e il
 * giocatore arriva col ruolo sbagliato e la quotazione di un altro campo.
 */
function cella(valore: unknown): string {
  return String(valore ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/,/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** L'ultima stagione di Serie A: le colonne di media voto e presenze vengono da li'. */
function ultimaSerieA(p: PlayerWithStats) {
  const serieA = (p.history ?? []).filter((s) => !s.competition || s.competition === SERIE_A_KEY);
  return serieA[0] ?? p.stats ?? null;
}

export type OpzioniLista = {
  /**
   * Cosa mettere nella colonna FVM.
   *
   * `ufficiale` lascia il numero di Fantacalcio.it: il tabellone mostra a tutti
   * quello che si aspettano. `nostro` ci mette il valore del motore, e siccome
   * FantaAstaLive ordina la lista per FVM decrescente, il tabellone finisce
   * ordinato secondo noi. Utile, ma e' un numero che vedono tutti: si sceglie.
   */
  fvm?: "ufficiale" | "nostro";
  /** Il valore del motore per giocatore, quando si sceglie `fvm: "nostro"`. */
  valori?: Map<string, number>;
};

/** Una riga della lista calciatori personalizzata: ventidue colonne, ordine fisso. */
export function rigaCalciatore(p: PlayerWithStats, opzioni: OpzioniLista = {}): string | null {
  // Senza identificativo ufficiale il giocatore non esiste per loro: le carte,
  // le rose e il confronto con la lista online passano tutti da quel numero.
  if (p.external_id == null) return null;

  const s = ultimaSerieA(p);
  const qIniziale = p.quotation_initial ?? p.quotation_current ?? 1;
  const qAttuale = p.quotation_current ?? qIniziale;
  const mantra = (p.role_mantra ?? []).filter(Boolean).join(";") || MANTRA_DA_RUOLO[p.role];
  const fvm =
    opzioni.fvm === "nostro"
      ? Math.round(opzioni.valori?.get(p.id) ?? p.fvm ?? 1)
      : Math.round(p.fvm ?? 1);
  const anno = p.identity?.birth_year ?? null;
  // L'anno sportivo comincia in agosto: fino a luglio si ha l'eta' dell'anno prima.
  const oggi = new Date();
  const stagione = oggi.getFullYear() + (oggi.getMonth() < 7 ? -1 : 0);
  const eta = anno ? stagione - anno : "";

  return [
    p.external_id, //  0 id
    cella(p.name), //  1 nome breve
    cella(p.identity?.full_name || p.name), //  2 nome completo
    p.role, //  3 ruolo classic
    mantra, //  4 ruoli mantra, separati da ;
    // Prima l'attuale, poi l'iniziale — in quest'ordine, non nell'altro.
    // Il numero che il tabellone usa come prezzo e' il primo dei due, e nel
    // file vero di Fantacalcio.it il primo e' Qt.A: misurato su tutti e 532 i
    // giocatori, nessuna eccezione.
    qAttuale, //  5 quotazione attuale classic — e' questa che fa da prezzo
    qIniziale, //  6 quotazione iniziale classic
    // Le quotazioni mantra il listone non le tiene: si ripetono le classic,
    // che in una lega classic non guarda nessuno.
    qAttuale, //  7 quotazione attuale mantra
    qIniziale, //  8 quotazione iniziale mantra
    cella(p.team), //  9 squadra
    fvm, // 10 FVM classic
    fvm, // 11 FVM mantra
    "", // 12 piede
    cella(p.identity?.nationality ?? ""), // 13 nato a
    "", // 14 data di nascita
    `${CARTA}${p.external_id}.png`, // 15 immagine
    0, // 16 ceduto
    s?.avg_vote != null ? s.avg_vote.toFixed(2) : "0.0", // 17 media voto
    s?.avg_fantavote != null ? s.avg_fantavote.toFixed(2) : "0.0", // 18 fantamedia
    s?.matches ?? 0, // 19 presenze
    eta, // 20 eta'
    CAMPIONATO_SERIE_A, // 21 campionato
  ].join(",");
}

/**
 * La lista calciatori da caricare in FantaAstaLive.
 *
 * Ordinata per FVM decrescente come la loro: cosi' il file si legge come lo
 * legge il tabellone, e un controllo a occhio basta a vedere se e' quello giusto.
 */
export function csvListaCalciatori(
  players: PlayerWithStats[],
  opzioni: OpzioniLista = {},
): string {
  const peso = (p: PlayerWithStats) =>
    opzioni.fvm === "nostro" ? (opzioni.valori?.get(p.id) ?? p.fvm ?? 0) : (p.fvm ?? 0);
  return (
    players
      .slice()
      .sort((a, b) => peso(b) - peso(a))
      .map((p) => rigaCalciatore(p, opzioni))
      .filter((r): r is string => r != null)
      .join("\n") + "\n"
  );
}

/**
 * Le squadre da sole, nel loro file di salvataggio.
 *
 * Il CSV delle rose non sa scrivere una squadra che non ha comprato nessuno, e
 * prima dell'asta sono tutte cosi'. La terza porta e' il file `.sav`: e'
 * `base64(JSON)` — `btoa(JSON.stringify(...))` nel loro codice — e all'apertura
 * applicano **solo le chiavi presenti** (`"teams" in f && Teams.save(f.teams)`).
 * Un file con le sole squadre crea le squadre e non tocca nient'altro.
 *
 * Due effetti collaterali del loro import, che avvengono con qualunque `.sav`:
 * azzera l'indice della prima chiamata e slega la lega di Fantacalcio.it
 * eventualmente collegata.
 */

/** La tavolozza delle squadre, copiata dalla loro. */
const COLORI = [
  "#ff2c2c", "#ff502c", "#ff772c", "#ffad33", "#46b134", "#219961", "#2c56ff",
  "#0f37db", "#5c2cff", "#dc41df", "#ff6286", "#80746a", "#6c4f39", "#272727",
];

/** Le loro icone di squadra, nello stesso ordine. */
const ICONE = "coffee dollar car like rocket skin trophy smile thunderbolt heart fire bug build crown".split(" ");

/** Oltre questo numero le squadre in piu' vengono ignorate da loro. */
export const MAX_SQUADRE = 20;

/**
 * JSON di soli caratteri ASCII.
 *
 * Loro codificano con `btoa`, che lavora a byte singoli, e rileggono con
 * `atob`: una "à" scritta in UTF-8 tornerebbe indietro come "Ã ". Scrivendo gli
 * accenti come `\uXXXX` il testo resta ASCII, il JSON resta valido e i nomi
 * tornano interi.
 */
function jsonAscii(valore: unknown): string {
  return JSON.stringify(valore).replace(/[\u0080-\uffff]/g, (c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function savSquadre(nomi: string[]): string {
  const teams = nomi.slice(0, MAX_SQUADRE).map((nome, i) => ({
    id: i,
    name: cella(nome) || `Squadra ${i + 1}`,
    color: COLORI[i % COLORI.length],
    icon: ICONE[i % ICONE.length],
  }));
  // `fileVer` e' l'unico campo che controllano prima di aprire il file.
  return Buffer.from(jsonAscii({ fileVer: 2, timestamp: Date.now(), teams }), "latin1").toString(
    "base64",
  );
}

export type AcquistoFAL = { squadra: string; playerId: number; prezzo: number };

/**
 * Le rose nel loro formato.
 *
 * Il file e' a blocchi: una riga `$,$,$` apre ogni squadra, poi una riga per
 * giocatore con `nome squadra,id,prezzo`. Il nome della squadra si ripete su
 * ogni riga; a contare, per loro, e' quante righe `$` sono passate prima.
 *
 * **Una squadra senza acquisti non si puo' scrivere.** Il loro lettore prende
 * il nome dalle righe dei giocatori, e ogni riga di giocatore diventa un
 * acquisto: un segnaposto con identificativo 0 creerebbe la squadra, ma anche
 * un calciatore fantasma `[#0]` in rosa, e all'import il tabellone direbbe
 * "Nessun calciatore riconosciuto" in rosso. Quindi le squadre vuote si
 * saltano — e' quello che fa anche il loro export, che raggruppa per squadra
 * le assegnazioni e non nomina chi non ne ha.
 */
export function csvRose(squadre: { nome: string; acquisti: { playerId: number; prezzo: number }[] }[]): string {
  let out = "";
  for (const s of squadre) {
    if (s.acquisti.length === 0) continue;
    out += "$,$,$\n";
    const nome = cella(s.nome) || "Squadra";
    for (const a of s.acquisti) out += `${nome},${a.playerId},${a.prezzo}\n`;
  }
  return out;
}

/**
 * Rileggere un file di rose esportato da FantaAstaLive.
 *
 * Stessa lettura loro: la prima riga deve essere esattamente `$,$,$`, le righe
 * che cominciano per `$` separano le squadre, il nome della squadra e' il primo
 * campo di ogni riga di giocatore.
 */
export function leggiRose(testo: string): AcquistoFAL[] | null {
  const righe = String(testo ?? "").split(/\r?\n/);
  if (righe[0]?.trim() !== "$,$,$") return null;
  const out: AcquistoFAL[] = [];
  for (const riga of righe) {
    if (riga.trim().startsWith("$")) continue;
    const campi = riga.split(",");
    const squadra = (campi[0] ?? "").trim();
    if (!squadra) continue;
    const playerId = Number(campi[1]);
    if (!Number.isFinite(playerId) || playerId <= 0) continue;
    out.push({ squadra, playerId, prezzo: Math.max(0, Math.round(Number(campi[2]) || 0)) });
  }
  return out;
}

/** Abbinare i nomi delle squadre del file ai partecipanti della lega. */
export function abbinaSquadre(
  nomi: string[],
  partecipanti: ParticipantRow[],
): Map<string, ParticipantRow> {
  const pulisci = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const perNome = new Map(partecipanti.map((p) => [pulisci(p.name), p]));
  const out = new Map<string, ParticipantRow>();
  for (const nome of nomi) {
    const trovato = perNome.get(pulisci(nome));
    if (trovato) out.set(nome, trovato);
  }
  return out;
}
