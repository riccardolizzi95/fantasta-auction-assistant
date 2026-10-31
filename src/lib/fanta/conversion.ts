import { competitionByKey, ratingToMediaVoto, SERIE_A_KEY, type Competition } from "./competitions";
import { trustOf } from "./reliability";
import { ROLE_BASELINE_MV, type PlayerStatsRow, type Role } from "./types";

/**
 * Una stagione riportata alla scala della Serie A, pronta per essere pesata.
 *
 * Puo' nascere dalla fusione di piu' competizioni giocate nello stesso anno
 * (campionato + coppe, o mezza stagione in Serie B e mezza in Serie A).
 */
export type NormalizedSeason = PlayerStatsRow & {
  /** Quanto vale questo campione rispetto a uno di pari dimensione in Serie A. */
  weightFactor: number;
  /** Da dove viene, per poterlo dire a schermo. */
  parts: { key: string; label: string; matches: number; production: number }[];
  /** false se e' tutta e sola Serie A. */
  converted: boolean;
};

/**
 * Gol subiti per partita da un portiere titolare di Serie A: misurato su 26
 * stagioni con almeno 20 presenze. Media 1.20, dal migliore al peggiore.
 */
const AVG_CONCEDED_PER_GAME = 1.2;
const CONCEDED_BEST = 0.74;
const CONCEDED_WORST = 1.78;

/**
 * Quanti gol subira' un portiere nella squadra dove gioca ADESSO.
 *
 * E' la cosa che conta di piu' per un portiere e la meno trasferibile: uno che
 * arriva dal Tottenham alla Juventus non porta con se' la difesa di prima. Dove
 * il dato manca, invece della media del campionato usiamo quella coerente con la
 * forza della sua squadra attuale.
 */
export function expectedConcededPerGame(teamStrength: number | undefined): number {
  if (teamStrength == null || !Number.isFinite(teamStrength)) return AVG_CONCEDED_PER_GAME;
  return CONCEDED_WORST - (CONCEDED_WORST - CONCEDED_BEST) * Math.min(1, Math.max(0, teamStrength));
}

const STD_BONUS = { goal: 3, assist: 1, yellow: -0.5, red: -1, ownGoal: -2, penSaved: 3, penMissed: -3, conceded: -1 };

/**
 * Quanto ci fidiamo del dato in base a chi ce l'ha dato. Un file ufficiale e una
 * API sportiva sono verificabili; quello che ricorda un modello linguistico no,
 * e va pesato di meno anche quando sembra plausibile.
 */
// La fiducia per fonte sta in reliability.ts insieme alla precedenza: erano due
// tabelle separate della stessa cosa, e non erano d'accordo fra loro.

/**
 * Porta una riga statistica sulla scala della Serie A.
 *
 * Due cose separate:
 * - la **produzione** (gol, assist, rigori) viene scalata: venti gol in
 *   Eredivisie non sono venti gol da noi;
 * - la **fantamedia** va ricostruita da zero, perche' fuori dall'Italia la media
 *   voto non esiste. Al massimo abbiamo un rating tipo SofaScore, che gira su
 *   una scala diversa e va tradotto.
 */
export function toSerieAEquivalent(
  row: PlayerStatsRow,
  role: Role,
  concededPerGame: number = AVG_CONCEDED_PER_GAME,
): NormalizedSeason {
  const comp = competitionByKey(row.competition ?? SERIE_A_KEY);
  const isSerieA = comp.key === SERIE_A_KEY;
  const m = Math.max(1, row.matches);

  // Una riga di Serie A dal file ufficiale porta gia' la fantamedia calcolata:
  // non c'e' niente da convertire. Se invece la fantamedia manca (inserimento a
  // mano, o risposta parziale di una fonte esterna) va ricostruita come per gli
  // altri campionati.
  if (isSerieA && row.avg_fantavote != null) {
    return {
      ...row,
      weightFactor: trustOf(row.source),
      parts: [{ key: comp.key, label: comp.label, matches: row.matches, production: 1 }],
      converted: false,
    };
  }

  const p = comp.production;

  // Un portiere che risulta a zero gol subiti su una stagione intera non ha
  // fatto l'impresa: e' un dato che la fonte non ha riportato. Assumere la porta
  // inviolata gli regalerebbe mezzo punto di fantamedia, che su un ruolo dove
  // l'intera forbice vale poco piu' di mezzo punto lo manderebbe in cima al
  // listone. Meglio la media di ruolo di un dato inventato.
  const rawConceded = Number(row.goals_conceded ?? 0);
  const concededSource =
    role === "P" && rawConceded <= 0 && row.matches >= 5
      ? row.matches * concededPerGame
      : rawConceded;
  const goals = Number(row.goals ?? 0) * p;
  const assists = Number(row.assists ?? 0) * p;
  const penScored = Number(row.pen_scored ?? 0) * p;
  const penMissed = Number(row.pen_missed ?? 0);
  const penSaved = Number(row.pen_saved ?? 0) * p;
  const yellow = Number(row.yellow_cards ?? 0);
  const red = Number(row.red_cards ?? 0);
  const ownGoals = Number(row.own_goals ?? 0);
  // Un portiere che in un campionato piu' debole subiva poco, da noi subisce di piu'.
  const concededScale = 1 / (0.5 + 0.5 * p);
  const conceded = concededSource * (role === "P" ? concededScale : 1);
  const cleanSheets = Number(row.clean_sheets ?? 0) * p;

  const mv =
    row.avg_vote != null
      ? Number(row.avg_vote)
      : (ratingToMediaVoto(row.rating, role) ?? ROLE_BASELINE_MV[role]);

  // La fantamedia se la stessa stagione fosse stata giocata in Serie A, con i
  // bonus standard: le regole della lega vengono applicate dopo, dal motore.
  const bonusPerMatch =
    (goals * STD_BONUS.goal +
      assists * STD_BONUS.assist +
      yellow * STD_BONUS.yellow +
      red * STD_BONUS.red +
      ownGoals * STD_BONUS.ownGoal +
      penSaved * STD_BONUS.penSaved +
      penMissed * STD_BONUS.penMissed +
      (role === "P" ? conceded * STD_BONUS.conceded : 0)) /
    m;

  return {
    ...row,
    avg_vote: mv,
    avg_fantavote: mv + bonusPerMatch,
    goals,
    assists,
    pen_scored: penScored,
    pen_missed: penMissed,
    pen_saved: penSaved,
    goals_conceded: conceded,
    clean_sheets: cleanSheets,
    weightFactor: comp.reliability * trustOf(row.source),
    parts: [{ key: comp.key, label: comp.label, matches: row.matches, production: p }],
    converted: true,
  };
}

/** Fonde piu' competizioni giocate nella stessa stagione in una riga sola. */
function mergeSeason(rows: NormalizedSeason[]): NormalizedSeason {
  if (rows.length === 1) return rows[0];
  const totalMatches = rows.reduce((a, r) => a + r.matches, 0) || 1;
  const wavg = (pick: (r: NormalizedSeason) => number | null | undefined) => {
    let num = 0;
    let den = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v == null) continue;
      num += Number(v) * r.matches;
      den += r.matches;
    }
    return den > 0 ? num / den : null;
  };
  const sum = (pick: (r: NormalizedSeason) => number | null | undefined) =>
    rows.reduce((a, r) => a + Number(pick(r) ?? 0), 0);

  const base = rows[0];
  return {
    ...base,
    matches: totalMatches,
    minutes: sum((r) => r.minutes) || null,
    avg_vote: wavg((r) => r.avg_vote),
    avg_fantavote: wavg((r) => r.avg_fantavote),
    goals: sum((r) => r.goals),
    assists: sum((r) => r.assists),
    own_goals: sum((r) => r.own_goals),
    yellow_cards: sum((r) => r.yellow_cards),
    red_cards: sum((r) => r.red_cards),
    pen_scored: sum((r) => r.pen_scored),
    pen_missed: sum((r) => r.pen_missed),
    pen_saved: sum((r) => r.pen_saved),
    goals_conceded: sum((r) => r.goals_conceded),
    clean_sheets: sum((r) => r.clean_sheets),
    weightFactor: rows.reduce((a, r) => a + r.weightFactor * r.matches, 0) / totalMatches,
    parts: rows.flatMap((r) => r.parts),
    converted: rows.some((r) => r.converted),
  };
}

/**
 * Converte e raggruppa tutta la carriera nota di un giocatore: una riga per
 * stagione, gia' sulla scala della Serie A, dalla piu' recente.
 */
export function normalizeHistory(
  history: PlayerStatsRow[],
  role: Role,
  concededPerGame?: number,
): NormalizedSeason[] {
  const bySeason = new Map<string, NormalizedSeason[]>();
  for (const row of history) {
    if (!row || row.matches <= 0) continue;
    const converted = toSerieAEquivalent(row, role, concededPerGame);
    const list = bySeason.get(row.season) ?? [];
    list.push(converted);
    bySeason.set(row.season, list);
  }
  return [...bySeason.entries()]
    .map(([, rows]) => mergeSeason(rows))
    .sort((a, b) => (a.season < b.season ? 1 : -1));
}

export type { Competition };
