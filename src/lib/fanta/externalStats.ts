/**
 * Utilita' per le statistiche che arrivano da fonti esterne (API o AI).
 * Stanno qui e non nella route perche' sono la parte che vale la pena testare.
 */
import { canOverwrite, levelOf, NOMI } from "./reliability";

export type StatRow = Record<string, unknown> & {
  player_id: string;
  season: string;
  competition: string;
  /** La squadra di quella stagione: fa parte della chiave. */
  club?: string | null;
};

const SUMMABLE = [
  "matches",
  "minutes",
  "goals",
  "assists",
  "own_goals",
  "yellow_cards",
  "red_cards",
  "pen_scored",
  "pen_missed",
  "pen_saved",
  "goals_conceded",
  "clean_sheets",
] as const;

/**
 * La chiave di una riga di storico.
 *
 * Comprende la **squadra**, e prima no: chi cambiava squadra a gennaio restando
 * nello stesso campionato aveva due righe che cadevano sulla stessa chiave, e
 * venivano sommate in una — dieci presenze a Parma e quindici a Genova
 * diventavano venticinque presenze di nessuno. Sommarle era il rimedio quando
 * non si poteva fare altro; adesso si possono tenere separate, che e' anche
 * quello che si vuole leggere.
 */
export const statKey = (r: {
  player_id: string;
  season: string;
  competition: string;
  club?: string | null;
}) => `${r.player_id}|${r.season}|${r.competition}|${r.club ?? ""}`;

/**
 * Fonde le righe che ricadrebbero sulla stessa chiave.
 *
 * Serve perche' una fonte esterna puo' restituire due volte la stessa stagione e
 * competizione: chi ha cambiato squadra a gennaio restando nello stesso
 * campionato compare una volta per squadra. Postgres rifiuta due righe con la
 * stessa chiave nello stesso comando, e le due meta' di stagione vanno sommate,
 * non scartate.
 */
/** La scala e' una sola, e sta in reliability.ts. */
const rankOf = (r: StatRow) => levelOf(r.source ?? "import");

/**
 * Fra righe della stessa stagione e competizione ma di fonti diverse non si
 * somma: si tiene la piu' affidabile. Sommare i gol trovati dall'API a quelli
 * riportati dall'AI raddoppierebbe lo stesso giocatore.
 */
export function preferBestSource(rows: StatRow[]): StatRow[] {
  const byKey = new Map<string, StatRow[]>();
  for (const r of rows) {
    const k = statKey(r);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const out: StatRow[] = [];
  for (const group of byKey.values()) {
    const best = Math.max(...group.map(rankOf));
    out.push(...mergeDuplicates(group.filter((r) => rankOf(r) === best)));
  }
  return out;
}

export function mergeDuplicates(rows: StatRow[]): StatRow[] {
  const byKey = new Map<string, StatRow>();
  for (const row of rows) {
    const key = statKey(row);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...row });
      continue;
    }
    const matchesBefore = Number(seen.matches ?? 0);
    for (const f of SUMMABLE) {
      seen[f] = Number(seen[f] ?? 0) + Number(row[f] ?? 0);
    }
    // Il rating e' una media, non un totale: va pesato sulle presenze.
    const a = Number(seen.rating ?? 0);
    const b = Number(row.rating ?? 0);
    const wb = Number(row.matches ?? 0);
    if (a > 0 && b > 0 && matchesBefore + wb > 0) {
      seen.rating = (a * matchesBefore + b * wb) / (matchesBefore + wb);
    } else if (b > 0 && a <= 0) {
      seen.rating = b;
    }
  }
  return [...byKey.values()];
}

/**
 * Toglie le righe che sostituirebbero un dato piu' affidabile.
 *
 * Prima proteggeva solo i file ufficiali, e bastava: le fonti erano due e
 * arrivavano nello stesso lotto, dove `preferBestSource` gia' decideva. Fra un
 * lotto e l'altro pero' non decideva nessuno, e l'upsert faceva vincere
 * l'ultimo che scriveva — cosi' una riga del modello poteva prendere il posto
 * di una dell'archivio, e una corsa automatica poteva cancellare una correzione
 * fatta a mano.
 *
 * Pari livello passa: una corsa dell'archivio piu' recente deve poter
 * aggiornare una piu' vecchia della stessa fonte.
 */
export function dropWhereBetterExists(
  rows: StatRow[],
  existing: {
    player_id: string;
    season: string;
    competition: string;
    club?: string | null;
    source?: string | null;
  }[],
): { keep: StatRow[]; skipped: number; protette: string[] } {
  const perChiave = new Map<string, string>();
  // Il livello migliore per **stagione e competizione**, squadra a parte.
  //
  // Serve perche' la squadra fa parte della chiave: senza questo, una riga a
  // memoria che dice "Milan" e una dell'archivio che dice "Genoa" sono due
  // chiavi diverse, nessuna delle due protegge l'altra, e la stessa stagione
  // finisce in archivio due volte — sommata dal motore come se avesse giocato
  // sessantanove partite. Due fonti che dicono due squadre diverse non sono due
  // mezze stagioni: e' un disaccordo, e vince la fonte piu' affidabile.
  const perStagione = new Map<string, string>();
  for (const e of existing) {
    const k = statKey(e);
    const attuale = perChiave.get(k);
    if (!attuale || levelOf(e.source) > levelOf(attuale)) perChiave.set(k, String(e.source ?? ""));
    const t = `${e.player_id}|${e.season}|${e.competition}`;
    const suo = perStagione.get(t);
    if (!suo || levelOf(e.source) > levelOf(suo)) perStagione.set(t, String(e.source ?? ""));
  }
  const protette: string[] = [];
  const keep = rows.filter((r) => {
    const esistente = perChiave.get(statKey(r));
    const perLaStagione = perStagione.get(`${r.player_id}|${r.season}|${r.competition}`);
    if (esistente === undefined && perLaStagione !== undefined && !canOverwrite(r.source, perLaStagione)) {
      protette.push(
        `${r.season} ${r.competition}: tenuto il dato da ${NOMI[perLaStagione as keyof typeof NOMI] ?? perLaStagione} (squadra diversa)`,
      );
      return false;
    }
    if (esistente === undefined) return true;
    if (canOverwrite(r.source, esistente)) return true;
    protette.push(
      `${r.season} ${r.competition}: tenuto il dato da ${NOMI[esistente as keyof typeof NOMI] ?? esistente}`,
    );
    return false;
  });
  return { keep, skipped: rows.length - keep.length, protette };
}
