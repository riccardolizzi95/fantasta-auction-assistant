/**
 * Quanto vale un'informazione, e chi puo' sovrascrivere chi.
 *
 * La regola e' una sola e non ha eccezioni: **un dato piu' affidabile non viene
 * mai sostituito da uno meno affidabile**. Non era cosi': la protezione copriva
 * solo i file ufficiali, e tutto il resto passava da un upsert dove vinceva
 * l'ultimo che scriveva. Nel database c'erano gia' due identita' verificate
 * dall'archivio sportivo e poi riscritte dal modello.
 *
 * Sta in un file suo perche' prima le scale erano due e non erano d'accordo:
 * `SOURCE_RANK` metteva l'archivio sopra l'inserimento a mano, `SOURCE_TRUST`
 * li dava pari. Due classifiche della stessa cosa sono una classifica sbagliata.
 */

export type Source = "import" | "api" | "manual" | "wikidata" | "ai";

/**
 * La scala. Numeri piu' alti battono numeri piu' bassi.
 *
 * - `import` — i file scaricati da Fantacalcio.it e caricati dall'utente. Sono
 *   la verita': nessuna ricostruzione li tocca, mai.
 * - `api` — l'archivio sportivo, con riscontro sull'anno di nascita.
 * - `manual` — inserito a mano nel pannello.
 * - `wikidata` — un'enciclopedia con le fonti citate. Non stima: riporta. Ma e'
 *   aggiornata da volontari, quindi su un mercato appena chiuso puo' essere
 *   indietro, ed e' per questo che sta sotto l'archivio sportivo e non sopra.
 * - `ai` — ricostruito dal modello, eventualmente con ricerca web. Plausibile,
 *   non verificato.
 *
 * NOTA — `manual` sotto `api` e' l'ordine storico del progetto, non una scelta
 * misurata. C'e' un argomento serio per invertirli: si corregge a mano proprio
 * quando le fonti automatiche hanno sbagliato, e la corsa dopo non dovrebbe
 * disfare la correzione. Cambiare questa riga e' tutto quello che serve.
 */
export const RELIABILITY: Record<Source, number> = {
  import: 5,
  api: 4,
  manual: 3,
  wikidata: 2,
  ai: 1,
};

export const NOMI: Record<Source, string> = {
  import: "file ufficiale",
  api: "archivio sportivo",
  manual: "inserito a mano",
  wikidata: "Wikidata",
  ai: "ricostruito dal modello",
};

export function levelOf(source: unknown): number {
  const s = String(source ?? "");
  return (RELIABILITY as Record<string, number>)[s] ?? 0;
}

/**
 * Se una fonte puo' scrivere sopra a quello che c'e'.
 *
 * Pari livello si', perche' una corsa dell'archivio piu' recente deve poter
 * aggiornare una piu' vecchia della stessa fonte. Livello piu' basso mai.
 */
export const canOverwrite = (nuova: unknown, esistente: unknown): boolean =>
  levelOf(nuova) >= levelOf(esistente);

/**
 * Quanto il motore si fida di una fonte quando ne pesa i numeri.
 *
 * E' una cosa diversa dalla precedenza: fra due righe decide chi vince, qui
 * decide quanto contare quella che ha vinto. Un dato dell'archivio e uno di un
 * file ufficiale hanno la stessa credibilita' una volta scritti; quello del
 * modello no, ed e' scontato del 35%.
 */
export const TRUST: Record<Source, number> = {
  import: 1,
  api: 1,
  manual: 1,
  // Wikidata cita le fonti, ma per le statistiche non e' un archivio sportivo:
  // se un giorno ne portera', vanno pesate meno di quelle verificate.
  wikidata: 0.85,
  ai: 0.65,
};

export const trustOf = (source: unknown): number =>
  (TRUST as Record<string, number>)[String(source ?? "import")] ?? 1;

/**
 * Se il nome nuovo e' lo stesso nome scritto per esteso.
 *
 * Serve per un caso reale: l'archivio sportivo restituisce "J. Stones" e
 * "K. Koulierakis", il modello restituisce "Arthur Theate" e "Giacomo Calo'".
 * Applicare la precedenza alla riga intera congelerebbe per sempre le
 * abbreviazioni, buttando via il dato migliore.
 *
 * Su un giocatore ci sono fatti diversi con padroni diversi: **chi e'** lo
 * decide l'archivio e non si discute, **come si scrive** puo' migliorarlo il
 * modello — ma solo se sta espandendo, non se sta cambiando persona. "J." che
 * diventa "John" e' un'espansione; "Sergiusz" al posto di "Nick" e' un'altra
 * persona, e va rifiutato.
 */
export function isExpansionOf(nuovo: string, esistente: string): boolean {
  const pulisci = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z. ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  const a = pulisci(nuovo);
  const b = pulisci(esistente);
  if (a.length === 0 || b.length === 0) return false;
  // Un'espansione ha almeno tante parole quante l'abbreviazione, e il cognome
  // — l'ultima parola — deve coincidere: e' quello che dice che e' la stessa
  // persona.
  if (a.length < b.length) return false;
  if (a[a.length - 1] !== b[b.length - 1]) return false;

  // Ogni parola dell'abbreviazione o e' identica, o e' l'iniziale di quella
  // corrispondente. Almeno una deve essere davvero un'iniziale, altrimenti non
  // stiamo espandendo niente e la precedenza deve valere.
  let espanse = 0;
  for (let i = 0; i < b.length; i++) {
    const vecchia = b[i].replace(/\./g, "");
    const nuova = (a[i] ?? "").replace(/\./g, "");
    if (vecchia === nuova) continue;
    if (vecchia.length === 1 && nuova.startsWith(vecchia)) {
      espanse += 1;
      continue;
    }
    return false;
  }
  return espanse > 0;
}
