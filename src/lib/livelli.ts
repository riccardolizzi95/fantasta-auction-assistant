/**
 * Tre livelli, e una sola domanda che conta: **puoi vedere i consigli?**
 *
 * - `base` vede i fatti e nient'altro: lo storico di un giocatore, chi ha
 *   comprato chi e a quanto, i propri crediti, la propria rosa come e'
 *   davvero. Nessun prezzo consigliato, nessun tetto, nessun obiettivo,
 *   nessuna strategia.
 * - `premium` vede il motore: prezzi, tetti, piano di spesa, la rosa che stai
 *   costruendo, la strategia.
 * - `admin` e' premium piu' l'amministrazione — il listone, gli account, le
 *   spazzate. Un amministratore e' sempre premium: non avrebbe senso importare
 *   i prezzi e non poterli vedere.
 *
 * Il confine e' fra fatto e giudizio, non fra dato semplice e dato complesso.
 * "Ha segnato 12 gol" e' un fatto anche se sta in fondo a tre query; "vale 94
 * crediti" e' un giudizio anche se e' un numero solo.
 */
export type Livello = "base" | "premium" | "admin";

export function livelloDa(profilo: { is_admin?: boolean | null; is_premium?: boolean | null } | null): Livello {
  if (!profilo) return "base";
  if (profilo.is_admin) return "admin";
  return profilo.is_premium ? "premium" : "base";
}

/** Se vede i consigli del motore. E' la domanda che si fanno quasi tutti i componenti. */
export const conConsigli = (livello: Livello): boolean => livello !== "base";

export const ETICHETTA_LIVELLO: Record<Livello, string> = {
  base: "Base",
  premium: "Premium",
  admin: "Amministratore",
};
