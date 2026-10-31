/**
 * Chi si sta contendendo il giocatore adesso.
 *
 * E' un dato che nasce nel pannello dell'ascolto e serve nella scheda del
 * giocatore, due punti dell'albero che non si parlano. Passarlo dal contesto
 * della lega vorrebbe dire far ridisegnare mezza pagina ogni volta che qualcuno
 * apre bocca, e la scheda del giocatore fa conti pesanti. Sta qui: chi lo vuole
 * si abbona, gli altri non se ne accorgono.
 */

export type Voce = { id: string; nome: string; quando: number };

let attuali: Voce[] = [];
const ascoltatori = new Set<() => void>();
const nessuno: Voce[] = [];

export function abbonatiAInGara(fn: () => void): () => void {
  ascoltatori.add(fn);
  return () => {
    ascoltatori.delete(fn);
  };
}

export function leggiInGara(): Voce[] {
  return attuali;
}

/** Sul server non c'e' nessuno che parla. */
export function inGaraSulServer(): Voce[] {
  return nessuno;
}

export function scriviInGara(voci: Voce[]): void {
  // Stessa lista, stesso oggetto: `useSyncExternalStore` ridisegna solo se cambia.
  if (
    voci.length === attuali.length &&
    voci.every((v, i) => attuali[i].id === v.id)
  ) {
    return;
  }
  attuali = voci;
  for (const f of ascoltatori) f();
}
