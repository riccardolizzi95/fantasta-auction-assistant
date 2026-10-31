/**
 * Una riga che si contraddice da sola e' inventata, e non va scritta.
 *
 * Non serve una seconda fonte per sapere che 315 presenze in un campionato da
 * 38 giornate non esistono: basta la riga stessa. Sono controlli gratuiti, e
 * per questo vengono prima di qualunque riscontro che costi — e' l'unico
 * livello di verifica che si puo' permettere di girare su ogni riga.
 *
 * Il caso che li ha fatti nascere e' vero: il modello ha attribuito a Maye 315
 * presenze di Serie A 2025-26, la riga e' finita in archivio e nessuno se n'e'
 * accorto finche' non e' stato chiesto un controllo complessivo.
 *
 * Il criterio e' **impossibile, non improbabile**. Un difensore con dodici gol
 * e' raro e va tenuto; un giocatore con piu' gol che minuti no. Rifiutare il
 * raro insieme all'impossibile farebbe perdere proprio i giocatori su cui si
 * vince l'asta.
 */
import type { Role } from "./types";

/** Quante giornate ha, al massimo, un campionato. */
const GIORNATE_MASSIME: Record<string, number> = {
  "serie-a": 38,
  "premier-league": 38,
  "la-liga": 38,
  "ligue-1": 34,
  bundesliga: 34,
  eredivisie: 34,
  "serie-b": 42,
  championship: 46,
};

/** Il tetto per una competizione sconosciuta: una coppa piu' un campionato lungo. */
const GIORNATE_DEFAULT = 60;

/**
 * La riga come arriva, non come vorremmo che fosse.
 *
 * I campi sono `unknown` di proposito: questo e' il controllo che sta fra una
 * fonte esterna e il database, e dichiarare `matches: number` su un dato che
 * arriva da un modello sarebbe una promessa che nessuno ha fatto. Chi valida
 * dati non fidati deve dirlo nel tipo.
 */
export type RigaDaControllare = Record<string, unknown>;

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const forse = (v: unknown): number | null => {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Cosa non torna in una riga. Vuoto vuol dire coerente — non vuol dire vera.
 */
export function incoerenze(riga: RigaDaControllare, role: Role): string[] {
  const problemi: string[] = [];
  const m = n(riga.matches);
  const tetto = GIORNATE_MASSIME[String(riga.competition ?? "serie-a")] ?? GIORNATE_DEFAULT;

  if (m <= 0) problemi.push("presenze a zero o negative");
  if (m > tetto) problemi.push(`${m} presenze in un campionato da ${tetto} giornate`);
  if (m <= 0) return problemi; // Da qui in giu' si divide per le presenze.

  if (n(riga.goals) > m * 3) problemi.push(`${n(riga.goals)} gol in ${m} presenze`);
  if (n(riga.assists) > m * 2) problemi.push(`${n(riga.assists)} assist in ${m} presenze`);
  // Due gialli fanno un rosso: piu' di due per partita non e' possibile.
  if (n(riga.yellow_cards) > m * 2) problemi.push(`${n(riga.yellow_cards)} ammonizioni in ${m} presenze`);
  if (n(riga.red_cards) > m) problemi.push(`${n(riga.red_cards)} espulsioni in ${m} presenze`);
  if (n(riga.pen_scored) > n(riga.goals)) {
    problemi.push(`${n(riga.pen_scored)} rigori segnati ma ${n(riga.goals)} gol in tutto`);
  }
  if (n(riga.clean_sheets) > m) problemi.push(`${n(riga.clean_sheets)} clean sheet in ${m} presenze`);

  const daTitolare = forse(riga.lineups);
  const min = forse(riga.minutes);

  // La titolarita' si confronta con le presenze della **stessa** fonte: `matches`
  // puo' venire da un conteggio diverso, e allora il paragone non dice niente.
  const presenzeStessaFonte = forse(riga.lineups_matches);
  if (daTitolare != null && presenzeStessaFonte != null && daTitolare > presenzeStessaFonte) {
    problemi.push(`${daTitolare} partite da titolare su ${presenzeStessaFonte} presenze`);
  }

  if (min != null && min > 0) {
    // Centotrenta minuti a presenza sono il massimo fisico: novanta piu' i
    // supplementari piu' un recupero lungo. La soglia era a cento e scartava
    // una riga vera — due partite di coppa per duecentodieci minuti, cioe' una
    // intera e una ai supplementari.
    if (min > m * 130) problemi.push(`${min} minuti in ${m} presenze`);
    // Quattro minuti a presenza e' il pavimento: anche una fila di ingressi al
    // novantesimo li supera. Sotto, i due numeri non parlano dello stesso
    // giocatore. L'archivio sportivo ha attribuito a Rafa Marin 38 presenze di
    // Serie A e 142 minuti — tre minuti e mezzo l'una — e la vecchia regola
    // (minuti >= presenze) la lasciava passare.
    if (min < m * 4) problemi.push(`${min} minuti in ${m} presenze`);
  }

  // Una partita da titolare si comincia dal primo minuto. Uscire prestissimo
  // capita, ma non in media su molte partite: nella stessa riga di Rafa Marin
  // c'erano 19 partite da titolare in 142 minuti.
  if (daTitolare != null && daTitolare >= 3 && min != null && min > 0 && min < daTitolare * 20) {
    problemi.push(`${daTitolare} partite da titolare in soli ${min} minuti`);
  }

  // I gol subiti sono del portiere. Su un giocatore di movimento sono la
  // colonna sbagliata o un'invenzione, e falsano il modificatore di difesa.
  if (role !== "P" && n(riga.goals_conceded) > 0) {
    problemi.push(`${n(riga.goals_conceded)} gol subiti attribuiti a un ${role}`);
  }
  if (role !== "P" && n(riga.pen_saved) > 0) {
    problemi.push(`rigori parati attribuiti a un ${role}`);
  }

  for (const [campo, valore] of [
    ["media voto", forse(riga.avg_vote)],
    ["fantamedia", forse(riga.avg_fantavote)],
    ["rating", forse(riga.rating)],
  ] as const) {
    const tettoAlto = campo === "rating" ? 10 : 20;
    if (valore != null && (valore < 1 || valore > tettoAlto)) {
      problemi.push(`${campo} fuori scala: ${valore}`);
    }
  }

  return problemi;
}

export const coerente = (riga: RigaDaControllare, role: Role) =>
  incoerenze(riga, role).length === 0;

/**
 * Divide le righe fra quelle scrivibili e quelle che si contraddicono.
 *
 * Le scartate tornano indietro con il motivo: servono a dirlo all'utente, e a
 * capire quale fonte sta inventando.
 */
export function separaIncoerenti<T extends RigaDaControllare>(
  righe: T[],
  ruoloDi: (riga: T) => Role,
): { buone: T[]; scartate: { riga: T; problemi: string[] }[] } {
  const buone: T[] = [];
  const scartate: { riga: T; problemi: string[] }[] = [];
  for (const r of righe) {
    const problemi = incoerenze(r, ruoloDi(r));
    if (problemi.length === 0) buone.push(r);
    else scartate.push({ riga: r, problemi });
  }
  return { buone, scartate };
}
