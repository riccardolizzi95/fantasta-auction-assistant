import type { AuctionEventRow, Rimozione, Spostamento } from "./types";

/**
 * "Ultimi movimenti": acquisti e annullamenti in un ordine solo.
 *
 * Stanno qui, e non dentro la schermata, perche' sono due regole che si
 * possono sbagliare in silenzio — l'ordine e il significato di un'azzerata —
 * e da qui si possono chiamare per davvero in una verifica.
 */

/** Una riga della lista: un acquisto, un annullamento, una correzione. */
export type Movimento = { chiave: string; quando: number } & (
  | { tipo: "acquisto"; e: AuctionEventRow }
  | { tipo: "annullato"; r: Rimozione }
  | { tipo: "spostato"; s: Spostamento }
);

/**
 * Il piu' fresco in cima, senza distinguere fra le due cose.
 *
 * Erano due liste, con gli annullamenti appesi sopra a tutto: dopo un'azzerata
 * di prova nove righe barrate coprivano i tre acquisti veri, che erano i piu'
 * recenti. Il tempo e' uno solo, e la lista lo segue.
 */
export function movimentiRecenti(
  events: AuctionEventRow[],
  rimozioni: Rimozione[],
  spostamenti: Spostamento[] = [],
  max = 40,
): Movimento[] {
  return [
    ...events.map(
      (e): Movimento => ({
        chiave: e.id,
        quando: Date.parse(e.created_at),
        tipo: "acquisto",
        e,
      }),
    ),
    ...rimozioni.map(
      (r): Movimento => ({
        chiave: `annullato-${r.playerId}-${r.quando}`,
        quando: r.quando,
        tipo: "annullato",
        r,
      }),
    ),
    ...spostamenti.map(
      (s): Movimento => ({
        chiave: `spostato-${s.playerId}-${s.quando}`,
        quando: s.quando,
        tipo: "spostato",
        s,
      }),
    ),
  ]
    .sort((a, b) => b.quando - a.quando)
    .slice(0, max);
}

/**
 * Se quello che e' appena sparito e' un'azzerata dell'asta.
 *
 * Azzerare non e' annullare degli acquisti: e' dire che quegli acquisti non
 * sono mai avvenuti. Sparisce tutto insieme e non resta niente, quindi non
 * c'e' nessuna notizia da dare e la lista si pulisce come le rose. L'ultimo
 * acquisto annullato a mano, invece, e' un annullamento vero: sparisce uno
 * solo, e la sua riga barrata resta.
 */
export function eUnAzzeramento(spariti: number, rimasti: number): boolean {
  return spariti > 1 && rimasti === 0;
}
