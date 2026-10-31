/**
 * Le fonti, dichiarate: cosa sanno produrre, quanto costano, che quota hanno.
 *
 * Serve perche' la domanda "aggiungiamo un'altra fonte" non abbia come risposta
 * "allunghiamo la catena di if". Ogni fonte si dichiara qui, e chi orchestra
 * legge questa tabella per decidere in che ordine provarle: **prima quelle che
 * non costano e non consumano quota**, e le altre solo su chi resta.
 *
 * E' anche la risposta al problema pratico: la quota giornaliera dell'archivio
 * sportivo copre una trentina di giocatori, e finche' era l'unica fonte gratuita
 * il recupero durava giorni. Fonti diverse hanno tetti diversi e indipendenti:
 * messe insieme, i tetti si sommano.
 */
import type { Source } from "./reliability";

/** Cosa una fonte sa dire di un giocatore. */
export type Capability = "identita" | "statistiche" | "stato-fisico";

export type SourceSpec = {
  key: Source;
  label: string;
  produces: Capability[];
  /**
   * Il tetto, quando c'e'. `null` vuol dire nessun limite pratico — non
   * "illimitato": vuol dire che il limite non e' quello che decide il ritmo.
   */
  quota: { perDay: number | null; perMinute: number | null };
  /** Dollari per chiamata, misurati. Zero e' zero, non "trascurabile". */
  costPerCall: number;
  /** La variabile d'ambiente che le serve, se ne serve una. */
  envKey: string | null;
  note: string;
};

export const SOURCES: SourceSpec[] = [
  {
    key: "wikidata",
    label: "Wikidata",
    produces: ["identita"],
    quota: { perDay: null, perMinute: null },
    costPerCall: 0,
    envKey: null,
    note:
      "Senza chiave e senza quota. Misurato: una query da cinque secondi copre " +
      "356 dei 533 giocatori del listone con nome per esteso e data di nascita.",
  },
  {
    key: "api",
    label: "API-Football",
    produces: ["identita", "statistiche", "stato-fisico"],
    quota: { perDay: 100, perMinute: 10 },
    costPerCall: 0,
    envKey: "APIFOOTBALL_KEY",
    note:
      "Gratis in denaro ma contingentata, ed e' il limite al minuto a mordere. " +
      "La fonte migliore per le statistiche verificate.",
  },
  {
    key: "ai",
    label: "Modello via OpenRouter",
    produces: ["identita", "statistiche"],
    quota: { perDay: null, perMinute: null },
    costPerCall: 0.0075,
    envKey: "OPENROUTER_API_KEY",
    note:
      "Nessun tetto ma si paga, ed e' l'unica che inventa: sullo stesso " +
      "giocatore due corse danno due nomi diversi. Ultima scelta, non prima.",
  },
];

export const sourceByKey = (key: Source): SourceSpec | undefined =>
  SOURCES.find((s) => s.key === key);

/**
 * In che ordine provare le fonti per un certo tipo di informazione.
 *
 * Prima il costo in denaro, poi la quota: una fonte gratuita e senza tetto va
 * sempre provata per prima, perche' quello che copre lei e' quota che le altre
 * non spendono. A parita', vince la piu' affidabile.
 */
export function ordinePerCosto(cosa: Capability, affidabilita: Record<Source, number>): SourceSpec[] {
  return SOURCES.filter((s) => s.produces.includes(cosa)).sort((a, b) => {
    if (a.costPerCall !== b.costPerCall) return a.costPerCall - b.costPerCall;
    const tettoA = a.quota.perDay ?? Infinity;
    const tettoB = b.quota.perDay ?? Infinity;
    if (tettoA !== tettoB) return tettoB - tettoA;
    return affidabilita[b.key] - affidabilita[a.key];
  });
}

/** Quali fonti sono davvero utilizzabili: quelle senza chiave, o con la chiave. */
export function disponibili(env: Record<string, string | undefined>): SourceSpec[] {
  return SOURCES.filter((s) => !s.envKey || !!env[s.envKey]);
}
