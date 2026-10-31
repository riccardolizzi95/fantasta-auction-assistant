import {
  DEFAULT_SLOTS,
  ROLE_BASELINE_FM,
  ROLE_BASELINE_MV,
  ROLE_FM_PERSISTENCE,
  ROLE_MV_PERSISTENCE,
  ROLES,
  SEASON_WEIGHTS,
  STARTERS_PER_TEAM,
  type LeagueRules,
  type PlayerStatsRow,
  type PlayerWithStats,
  type Role,
  type RoleMap,
} from "./types";
import { SERIE_A_KEY } from "./competitions";
import {
  expectedConcededPerGame,
  normalizeHistory,
  type NormalizedSeason,
} from "./conversion";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Bonus/malus dello standard Lega Fantacalcio, usati per calcolare la fantamedia
 * pubblicata. Se la lega ha regole diverse ricalcoliamo il delta sui numeri reali
 * del giocatore invece di fidarci della fantamedia grezza.
 */
const STD = {
  goal: 3,
  assist: 1,
  yellow: -0.5,
  red: -1,
  ownGoal: -2,
  penScored: 3,
  penMissed: -3,
  penSaved: 3,
  goalConceded: -1,
};

/**
 * Il modificatore di difesa vale circa 4 fantapunti passando da una media difesa
 * di 5.5 a una di 6.5, e la media e' calcolata su 5 giocatori (portiere + 4 difensori).
 * Quindi il singolo difensore muove l'ago di ~0.8 punti per ogni punto di media voto.
 */
const DEF_MOD_SLOPE = 0.8;

/** Presenze verso cui regrediamo chi ha giocato poco: una stagione "normale". */
const APPS_PRIOR = 24;
const APPS_PRIOR_WEIGHT = 0.32;

export type Projection = {
  playerId: string;
  role: Role;
  /** Presenze attese sulle 38 giornate. */
  expApps: number;
  /** Fantamedia attesa, riadattata alle regole di questa lega. */
  expFM: number;
  /** Media voto attesa (senza bonus). Serve al modificatore. */
  expMV: number;
  /** Fantapunti/gara aggiunti dal modificatore di difesa, se attivo. */
  defModBonus: number;
  /** expFM + defModBonus: il valore che conta davvero in questa lega. */
  effFM: number;
  /** 0..1: quanto e' affidabile il campione statistico. */
  reliability: number;
  /** Stagioni entrate nel calcolo, dalla piu' recente. */
  seasonsUsed: string[];
  /** Campionati diversi dalla Serie A usati per stimarlo. */
  convertedFrom: { key: string; label: string; matches: number }[];
  /** Punti fanta attesi sull'intera stagione (grezzi, non ancora relativizzati). */
  seasonPoints: number;
  hasData: boolean;
};

export type Tier = "top" | "semi-top" | "buono" | "scommessa" | "riempitivo";

export type Valuation = Projection & {
  /** Fantapunti/giornata guadagnati rispetto al giocatore di rimpiazzo del ruolo. */
  vor: number;
  /** Prezzo "giusto" in crediti a mercato neutro (nessuna inflazione, nessuna strategia). */
  baseValue: number;
  tier: Tier;
  rankInRole: number;
  /** Prezzo che il mercato gli dara' secondo il Fantavalore ufficiale. */
  marketPrice: number;
  /** baseValue / marketPrice: >1 il mercato lo sottovaluta, <1 lo sopravvaluta. */
  edgeVsMarket: number;
  /** Forza della squadra di appartenenza, 0..1 rispetto al resto della Serie A. */
  teamStrength: number;
  /**
   * Chi tira i rigori della sua squadra, se e' lui.
   *
   * Non entra nel prezzo: i rigori dell'anno scorso sono gia' dentro la sua
   * fantamedia dell'anno scorso, e sommarli di nuovo li conterebbe due volte.
   * Serve a dirlo, che all'asta e' una delle prime cose che si guarda.
   *
   * Misurato su 387 giocatori che segnavano (`npm run check:rigoristi`): un gol
   * su rigore si ripete l'anno dopo nel 60% dei casi, uno su azione nel 46%.
   * Quindi non e' un valore fragile da scontare — e' il contrario. E chi ne ha
   * tirati almeno tre l'anno dopo ne tira 1.6 in media, contro 0.1 di chi non
   * ne ha tirato nessuno: sapere chi e' il rigorista dice qualcosa di vero.
   */
  rigorista?: { tirati: number; dellaSquadra: number; stagione: string };
};

export type ValuationContext = {
  /** Stagione dell'asta: se ne esistono statistiche, e' un campionato in corso. */
  season: string;
  nParticipants: number;
  budget: number;
  slots: RoleMap<number>;
  rules: LeagueRules;
  /**
   * Forza la soglia del rimpiazzo invece di dedurla dal listino.
   *
   * Serve a misurare fin dove arriva la manopola: 0 concentra al massimo, 1
   * appiattisce. In produzione resta vuoto e la soglia si cerca per bisezione.
   */
  benchOverride?: number;
  /**
   * Quanto sono andati i piu' cari in un'asta vera di questa lega.
   *
   * E' il modo giusto di tarare la concentrazione, e sostituisce il listino.
   * Il listino e' un **prezziario**: dice quanto vale un giocatore, non quanto
   * la gente paga quando c'e' da alzare la mano. Misurato sui dati veri: tarato
   * sul listino il piu' caro vale 141 su un budget di 500, mentre in questa lega
   * Lautaro Martinez e' andato a 240 e David a 280. Il modello valeva i top
   * meno della meta' di quanto costano, e chi lo seguiva li perdeva tutti
   * restando con i crediti in mano.
   *
   * `budget` e' quello dell'asta da cui vengono i prezzi: se e' diverso da
   * quello di adesso, si riscalano.
   */
  topPrices?: { prices: number[]; budget: number };
};

// ---------------------------------------------------------------------------
// Proiezione del singolo giocatore
// ---------------------------------------------------------------------------

export type BlendedStats = {
  /** Campione efficace: le stagioni piu' vecchie contano meno di una presenza intera. */
  matches: number;
  /** Presenze nella stagione piu' recente: e' quello che dice se e' titolare adesso. */
  recentMatches: number;
  /** Media pesata delle presenze nelle stagioni precedenti, se ce ne sono. */
  olderMatches: number | null;
  minutesPerMatch: number | null;
  /** Presenze nella stagione in corso, se ne sono state caricate. */
  currentMatches: number | null;
  /** Quota di giornate in cui ha preso voto quest'anno: 1 = sempre titolare. */
  currentStarterRate: number | null;
  /** Non compare proprio nel file di quest'anno: potrebbe anche essere un buco nei dati. */
  currentRowMissing: boolean;
  avg_vote: number | null;
  avg_fantavote: number | null;
  goals: number;
  assists: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  pen_scored: number;
  pen_missed: number;
  pen_saved: number;
  goals_conceded: number;
  clean_sheets: number;
  seasons: string[];
  /** Le competizioni non italiane che hanno contribuito. */
  convertedFrom: { key: string; label: string; matches: number }[];
};

const COUNT_FIELDS = [
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
 * Fonde le stagioni disponibili in un'unica riga statistica.
 *
 * I conteggi diventano tassi per presenza, mediati con peso = peso della
 * stagione x presenze giocate, e poi riportati sul campione complessivo. Cosi'
 * un giocatore con tre stagioni solide risulta piu' affidabile di uno con una
 * sola annata buona, senza che le stagioni vecchie ne schiaccino il rendimento
 * attuale.
 */
export type BlendOptions = {
  /** Stagione in corso: le sue statistiche esistono ma valgono poco all'inizio. */
  currentSeason?: string;
  /** Giornate gia' giocate nella stagione in corso. */
  matchdaysPlayed?: number;
};

/**
 * Quanto ci vuole perche' la stagione in corso pesi come una finita.
 *
 * Alla seconda giornata una fantamedia da 15 non dice niente: dice solo che ha
 * segnato una doppietta. Il peso parte quasi da zero e sale in fretta, cosi'
 * verso meta' girone il campionato in corso comanda sul passato.
 */
export const CURRENT_SEASON_SHRINK = 6;

export function currentSeasonWeight(matches: number): number {
  return matches * (matches / (matches + CURRENT_SEASON_SHRINK));
}

export function blendStats(
  history: NormalizedSeason[],
  opts: BlendOptions = {},
): BlendedStats | null {
  // La riga della stagione in corso va cercata prima del filtro: "zero presenze
  // finora" e' un'informazione, non un dato mancante.
  const currentRow = opts.currentSeason
    ? (history.find((r) => r.season === opts.currentSeason) ?? null)
    : null;

  const all = history.filter((r) => r.matches > 0);
  if (all.length === 0) return null;

  const current = currentRow && currentRow.matches > 0 ? currentRow : null;
  // Le stagioni concluse mantengono la scala 100/55/30: quella in corso non deve
  // rubare il primo posto a un'annata intera solo perche' e' piu' recente.
  const completed = all
    .filter((r) => r.season !== opts.currentSeason)
    .slice(0, SEASON_WEIGHTS.length);

  // Il campione di una stagione convertita da un altro campionato vale meno di
  // uno di pari dimensione giocato in Serie A: weightFactor lo sconta.
  const weighted: { row: NormalizedSeason; w: number }[] = [];
  if (current) {
    weighted.push({ row: current, w: currentSeasonWeight(current.matches) * current.weightFactor });
  }
  completed.forEach((r, i) =>
    weighted.push({ row: r, w: SEASON_WEIGHTS[i] * r.matches * r.weightFactor }),
  );

  let weightTotal = 0;
  let mvNum = 0;
  let mvWeight = 0;
  let fmNum = 0;
  let fmWeight = 0;
  const rateNum: Record<string, number> = {};
  for (const f of COUNT_FIELDS) rateNum[f] = 0;

  for (const { row: r, w } of weighted) {
    weightTotal += w;
    if (r.avg_vote != null) {
      mvNum += w * Number(r.avg_vote);
      mvWeight += w;
    }
    if (r.avg_fantavote != null) {
      fmNum += w * Number(r.avg_fantavote);
      fmWeight += w;
    }
    for (const f of COUNT_FIELDS) rateNum[f] += w * (Number(r[f] ?? 0) / r.matches);
  }
  if (weightTotal <= 0) return null;

  // Per la titolarita' guardiamo le stagioni concluse: due giornate non bastano
  // a dire quante partite giochera' in un anno, ma dicono benissimo se il posto
  // da titolare ce l'ha adesso (vedi currentStarterRate).
  const base = completed.length > 0 ? completed : current ? [current] : [];
  const older = base.slice(1);
  const olderWeight = older.reduce((a, _r, i) => a + SEASON_WEIGHTS[i + 1], 0);
  const olderMatches =
    older.length > 0
      ? older.reduce((a, r, i) => a + SEASON_WEIGHTS[i + 1] * r.matches, 0) / olderWeight
      : null;

  const md = opts.matchdaysPlayed ?? 0;
  const out = {
    matches: weightTotal,
    recentMatches: base[0]?.matches ?? 0,
    olderMatches,
    minutesPerMatch: base[0]?.minutes ? base[0].minutes / base[0].matches : null,
    currentMatches: currentRow ? currentRow.matches : null,
    // Chi non compare affatto nel file di quest'anno ha comunque giocato zero.
    currentStarterRate: md > 0 ? clamp((currentRow?.matches ?? 0) / md, 0, 1) : null,
    currentRowMissing: currentRow == null,
    avg_vote: mvWeight > 0 ? mvNum / mvWeight : null,
    avg_fantavote: fmWeight > 0 ? fmNum / fmWeight : null,
    seasons: weighted.map((x) => x.row.season),
    convertedFrom: weighted
      .flatMap((x) => x.row.parts)
      .filter((part) => part.key !== SERIE_A_KEY)
      .map(({ key, label, matches }) => ({ key, label, matches })),
  } as BlendedStats;
  for (const f of COUNT_FIELDS) out[f] = (rateNum[f] / weightTotal) * out.matches;
  return out;
}

function ruleDelta(role: Role, s: BlendedStats | null, rules: LeagueRules): number {
  if (!s || s.matches <= 0) return 0;
  const assistValue = rules.assist_enabled ? rules.assist_bonus : 0;
  const delta =
    s.goals * (rules.goal_bonus[role] - STD.goal) +
    s.assists * (assistValue - STD.assist) +
    s.yellow_cards * (rules.yellow_card - STD.yellow) +
    s.red_cards * (rules.red_card - STD.red) +
    s.own_goals * (rules.own_goal - STD.ownGoal) +
    s.pen_scored * (rules.pen_scored - STD.penScored) +
    s.pen_missed * (rules.pen_missed - STD.penMissed) +
    s.pen_saved * (rules.pen_saved - STD.penSaved) +
    (role === "P" ? s.goals_conceded * (rules.goal_conceded - STD.goalConceded) : 0) +
    s.clean_sheets * rules.clean_sheet_bonus;
  return delta / s.matches;
}

/**
 * Chi non ha statistiche (neopromossi, nuovi acquisti dall'estero, giovani) viene
 * stimato dalla quotazione: prendiamo il suo percentile di quotazione nel ruolo e
 * leggiamo la fantamedia corrispondente fra chi i dati ce li ha, poi la tiriamo
 * verso la media perche' e' una stima, non un dato.
 */
function buildQuotationMapper(
  pool: PlayerWithStats[],
  blendOpts: BlendOptions,
  teamStrength: Map<string, number>,
) {
  const byRole = new Map<Role, { quots: number[]; fms: number[]; mvs: number[] }>();
  for (const role of ROLES) byRole.set(role, { quots: [], fms: [], mvs: [] });

  for (const p of pool) {
    const bucket = byRole.get(p.role)!;
    const q = p.quotation_initial ?? p.quotation_current ?? p.fvm ?? 1;
    bucket.quots.push(q);
    const blended = blendStats(historyOf(p, teamStrength.get(p.team)), blendOpts);
    if (blended && blended.matches >= 15) {
      if (blended.avg_fantavote != null) bucket.fms.push(blended.avg_fantavote);
      if (blended.avg_vote != null) bucket.mvs.push(blended.avg_vote);
    }
  }
  for (const bucket of byRole.values()) {
    bucket.quots.sort((a, b) => a - b);
    bucket.fms.sort((a, b) => a - b);
    bucket.mvs.sort((a, b) => a - b);
  }

  const quantile = (sorted: number[], p: number, fallback: number) => {
    if (sorted.length === 0) return fallback;
    const idx = clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[idx];
  };

  const roleMean = (values: number[], fallback: number) =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
  const means = {} as Record<Role, { fm: number; mv: number }>;
  for (const role of ROLES) {
    const bucket = byRole.get(role)!;
    means[role] = {
      fm: roleMean(bucket.fms, ROLE_BASELINE_FM[role]),
      mv: roleMean(bucket.mvs, ROLE_BASELINE_MV[role]),
    };
  }

  const estimate = (player: PlayerWithStats) => {
    const bucket = byRole.get(player.role)!;
    const q = player.quotation_initial ?? player.quotation_current ?? player.fvm ?? 1;
    const below = bucket.quots.filter((x) => x < q).length;
    const pct = bucket.quots.length > 1 ? below / (bucket.quots.length - 1) : 0.5;
    const fm = quantile(bucket.fms, pct, ROLE_BASELINE_FM[player.role]);
    const mv = quantile(bucket.mvs, pct, ROLE_BASELINE_MV[player.role]);
    // 30% di shrink verso la media: senza dati non possiamo essere sicuri.
    return {
      pct,
      fm: ROLE_BASELINE_FM[player.role] + 0.7 * (fm - ROLE_BASELINE_FM[player.role]),
      mv: ROLE_BASELINE_MV[player.role] + 0.7 * (mv - ROLE_BASELINE_MV[player.role]),
    };
  };

  return { estimate, means };
}

/**
 * Le stagioni note del giocatore, gia' riportate alla scala della Serie A:
 * chi arriva dall'estero o dalla Serie B entra nel calcolo come tutti gli altri,
 * solo con la produzione scalata e un peso minore.
 */
function historyOf(p: PlayerWithStats, teamStrength?: number): NormalizedSeason[] {
  const raw = p.history?.length ? p.history : p.stats ? [p.stats] : [];
  return normalizeHistory(raw, p.role, expectedConcededPerGame(teamStrength));
}

export type RoleMeans = Record<Role, { fm: number; mv: number }>;

export function projectPlayer(
  p: PlayerWithStats,
  rules: LeagueRules,
  fallback: (player: PlayerWithStats) => { pct: number; fm: number; mv: number },
  blendOpts: BlendOptions = {},
  means?: RoleMeans,
  teamStrength?: number,
): Projection {
  const s = blendStats(historyOf(p, teamStrength), blendOpts);
  const matches = s?.matches ?? 0;
  const hasData = matches >= 5 && s?.avg_fantavote != null;
  const reliability = clamp(matches / 25, 0, 1);
  const guess = fallback(p);

  let expFM: number;
  let expMV: number;
  if (hasData) {
    const rawFM = Number(s!.avg_fantavote) + ruleDelta(p.role, s, rules);
    const rawMV = s!.avg_vote != null ? Number(s!.avg_vote) : ROLE_BASELINE_MV[p.role];
    // Il campione piccolo viene tirato verso la stima da quotazione, non verso la
    // media di ruolo: un titolare da 30 milioni con 6 presenze non e' un giocatore medio.
    expFM = reliability * rawFM + (1 - reliability) * guess.fm;
    expMV = reliability * rawMV + (1 - reliability) * guess.mv;
  } else {
    expFM = guess.fm;
    expMV = guess.mv;
  }

  // -------------------------------------------------------------------------
  // Regressione verso la media.
  //
  // Anche una stagione intera misurata bene sovrastima il futuro: solo una parte
  // dello scarto dalla media si ripete l'anno dopo, e quanta dipende dal ruolo
  // (vedi ROLE_FM_PERSISTENCE). Piu' stagioni si hanno, meno rumore c'e' nella
  // stima di partenza e meno serve tirare verso la media: k e' il numero di
  // stagioni equivalenti nel campione.
  // -------------------------------------------------------------------------
  const meanFM = means?.[p.role].fm ?? ROLE_BASELINE_FM[p.role];
  const meanMV = means?.[p.role].mv ?? ROLE_BASELINE_MV[p.role];
  const k = clamp((s?.matches ?? 0) / 30, 0.15, 2.5);
  const persist = (rho: number) => rho / (rho + (1 - rho) / k);
  expFM = meanFM + persist(ROLE_FM_PERSISTENCE[p.role]) * (expFM - meanFM);
  expMV = meanMV + persist(ROLE_MV_PERSISTENCE[p.role]) * (expMV - meanMV);

  let expApps: number;
  if (s && s.recentMatches > 0) {
    // Per le presenze conta soprattutto l'ultima stagione conclusa: le precedenti
    // servono a non condannare chi ha saltato un anno per infortunio.
    const base =
      s.olderMatches != null ? 0.72 * s.recentMatches + 0.28 * s.olderMatches : s.recentMatches;
    expApps = (1 - APPS_PRIOR_WEIGHT) * base + APPS_PRIOR_WEIGHT * APPS_PRIOR;
    // Qui c'era una correzione sui minuti a partita — chi entra dal 70' prende
    // meno voti, chi gioca 90' e' un titolare consolidato — e sembrava ovvia.
    // Misurata su 240 coppie di stagioni consecutive vere (`npm run
    // check:titolarita`) **spinge dalla parte sbagliata**: chi l'anno prima
    // giocava meno di trenta minuti l'anno dopo fa in media 23 presenze, non
    // meno, perche' o si e' guadagnato il posto o e' andato in una squadra dove
    // gioca. Toglierla migliora l'errore medio da 8.98 a 8.71 presenze e
    // dimezza lo scarto sistematico sui titolari fissi, da +3.2 a +1.7.
    //
    // Il fenomeno vero e' la regressione verso la media, che qui e' gia' quella
    // che comanda: tirare piu' forte di cosi' (provato fino a 0.7) raddrizza i
    // panchinari ma storta tutti gli altri e alza l'errore. Anche le titolarita'
    // vere, dove le abbiamo, non aggiungono niente: 7.68 contro 7.70.
  } else {
    expApps = 14 + 18 * guess.pct;
  }

  // A campionato iniziato la domanda non e' piu' "quanto ha giocato l'anno
  // scorso" ma "sta giocando adesso". Due giornate dicono poco sulla fantamedia
  // e moltissimo sulle gerarchie: chi le ha giocate entrambe il posto ce l'ha.
  const md = blendOpts.matchdaysPlayed ?? 0;
  if (s && s.currentStarterRate != null && md > 0) {
    // Essere assenti dal file e' un indizio piu' debole di esserci con zero
    // presenze: potrebbe mancare la riga, non il giocatore.
    const confidence = (md / (md + 5)) * (s.currentRowMissing ? 0.75 : 1);
    expApps = confidence * (s.currentStarterRate * 38) + (1 - confidence) * expApps;
  }
  expApps = clamp(expApps, 0, 38);

  return {
    playerId: p.id,
    role: p.role,
    expApps,
    expFM,
    expMV,
    // Il contributo del modificatore si calcola dopo, quando sappiamo qual e' il
    // difensore "gratis" con cui confrontarsi (vedi buildValuations).
    defModBonus: 0,
    effFM: expFM,
    reliability,
    seasonsUsed: s?.seasons ?? [],
    convertedFrom: s?.convertedFrom ?? [],
    seasonPoints: expApps * expFM,
    hasData,
  };
}

/** Il modificatore e' attivo per questo ruolo? */
function modifierApplies(role: Role, rules: LeagueRules): boolean {
  if (role === "P") return rules.defense_modifier || rules.goalkeeper_modifier;
  if (role === "D") return rules.defense_modifier;
  return false;
}

// ---------------------------------------------------------------------------
// Da proiezione a prezzo: VOR (Value Over Replacement) convertito in crediti
// ---------------------------------------------------------------------------

function computeTeamStrength(pool: PlayerWithStats[]): Map<string, number> {
  const byTeam = new Map<string, number[]>();
  for (const p of pool) {
    const q = p.quotation_initial ?? p.quotation_current ?? p.fvm ?? 1;
    if (!byTeam.has(p.team)) byTeam.set(p.team, []);
    byTeam.get(p.team)!.push(Number(q));
  }
  const totals = new Map<string, number>();
  for (const [team, quots] of byTeam) {
    quots.sort((a, b) => b - a);
    totals.set(team, quots.slice(0, 11).reduce((a, b) => a + b, 0));
  }
  const values = [...totals.values()].sort((a, b) => a - b);
  if (values.length === 0) return new Map();
  const lo = values[0];
  const hi = values[values.length - 1];
  const span = hi - lo || 1;
  const out = new Map<string, number>();
  for (const [team, total] of totals) out.set(team, clamp((total - lo) / span, 0, 1));
  return out;
}

function tierOf(baseValue: number, budget: number): Tier {
  const share = baseValue / budget;
  if (share >= 0.12) return "top";
  if (share >= 0.06) return "semi-top";
  if (share >= 0.025) return "buono";
  if (share >= 0.008) return "scommessa";
  return "riempitivo";
}

export type ValuationResult = {
  byPlayer: Map<string, Valuation>;
  byRole: RoleMap<Valuation[]>;
  replacementFM: RoleMap<number>;
  replacementMV: RoleMap<number>;
  /** Giornate gia' giocate nella stagione dell'asta: 0 se il campionato non e' iniziato. */
  matchdaysPlayed: number;
  /**
   * Quanta panchina entra nel livello di rimpiazzo, 0..1, tarata sul listino.
   * 0 = conta solo la formazione titolare (prezzi molto concentrati),
   * 1 = conta tutta la rosa (prezzi piatti).
   */
  benchDepth: number;
  /**
   * Se i valori sono tarati su prezzi d'asta veri invece che sul listino.
   *
   * Cambia come vanno letti: un prezzo pagato contiene gia' la pressione
   * dell'asta, mentre il listino no. Chi applica poi la scarsita' deve saperlo,
   * altrimenti la conta due volte.
   */
  anchoredOnRealPrices: boolean;
  pricePerVOR: number;
  totalMarketValue: number;
};

/**
 * Calcola il prezzo di equilibrio di ogni giocatore.
 *
 * L'idea: quello che conta non e' quanto vale un giocatore in assoluto, ma quanto
 * vale *in piu'* del giocatore che prenderesti gratis al suo posto (il "rimpiazzo").
 * La somma di questi vantaggi e' tutto cio' per cui vale la pena spendere, e i
 * crediti della lega si spartiscono in proporzione.
 */
/**
 * Chi ha tirato i rigori della sua squadra, nell'ultima stagione conclusa.
 *
 * Si guarda l'ultima stagione **finita** in cui qualcuno ha battuto un rigore:
 * quella in corso ha giocato due giornate e non dice niente. E si conta chi li
 * ha **tirati**, segnati o sbagliati, perche' il rigorista e' chi ci va, non chi
 * ci prende.
 *
 * Un giocatore conta come rigorista se ne ha tirati almeno due e ne ha tirati
 * piu' di chiunque altro nella sua squadra: uno solo puo' essere il rigore
 * battuto perche' quel giorno il titolare non era in campo.
 */
function chiTiraIRigori(
  pool: PlayerWithStats[],
  stagioneInCorso: string,
): Map<string, { tirati: number; dellaSquadra: number; stagione: string }> {
  const out = new Map<string, { tirati: number; dellaSquadra: number; stagione: string }>();
  const stagioni = new Set<string>();
  for (const p of pool)
    for (const h of p.history ?? [])
      if (h.season !== stagioneInCorso && ((h.pen_scored ?? 0) + (h.pen_missed ?? 0)) > 0) {
        stagioni.add(h.season);
      }
  const ultima = [...stagioni].sort().reverse()[0];
  if (!ultima) return out;

  const perSquadra = new Map<string, { id: string; tirati: number }[]>();
  for (const p of pool) {
    const riga = (p.history ?? []).find(
      (h) => h.season === ultima && (h.competition ?? SERIE_A_KEY) === SERIE_A_KEY,
    );
    const tirati = (riga?.pen_scored ?? 0) + (riga?.pen_missed ?? 0);
    if (tirati <= 0) continue;
    const lista = perSquadra.get(p.team) ?? [];
    lista.push({ id: p.id, tirati });
    perSquadra.set(p.team, lista);
  }
  for (const [, lista] of perSquadra) {
    const dellaSquadra = lista.reduce((a, x) => a + x.tirati, 0);
    const ordinata = lista.sort((a, b) => b.tirati - a.tirati);
    const primo = ordinata[0];
    if (primo.tirati < 2 || (ordinata[1] && ordinata[1].tirati === primo.tirati)) continue;
    out.set(primo.id, { tirati: primo.tirati, dellaSquadra, stagione: ultima });
  }
  return out;
}

export function buildValuations(
  pool: PlayerWithStats[],
  ctx: ValuationContext,
): ValuationResult {
  const slots = ctx.slots ?? DEFAULT_SLOTS;

  // Quante giornate si sono giocate: lo deduciamo dal giocatore che ne ha di piu'
  // nella stagione in corso. Se nessuno ha statistiche di quest'anno, l'asta e'
  // prima dell'inizio del campionato e non c'e' niente da correggere.
  let matchdaysPlayed = 0;
  for (const p of pool) {
    for (const h of p.history ?? []) {
      if (h.season === ctx.season && h.matches > matchdaysPlayed) matchdaysPlayed = h.matches;
    }
  }
  const blendOpts: BlendOptions = { currentSeason: ctx.season, matchdaysPlayed };

  const rigoristi = chiTiraIRigori(pool, ctx.season);
  const teamStrength = computeTeamStrength(pool);
  const { estimate: fallback, means } = buildQuotationMapper(pool, blendOpts, teamStrength);

  const projections = pool.map((p) =>
    projectPlayer(p, ctx.rules, fallback, blendOpts, means, teamStrength.get(p.team)),
  );
  const projById = new Map(projections.map((p) => [p.playerId, p]));

  const byRoleProj: RoleMap<Projection[]> = { P: [], D: [], C: [], A: [] };
  for (const proj of projections) byRoleProj[proj.role].push(proj);

  // -------------------------------------------------------------------------
  // Prezzo di consenso del mercato, dal Fantavalore ufficiale. Serve a due cose:
  // capire dove il listino e il modello non sono d'accordo (= gli affari), e
  // tarare quanto il prezzo debba concentrarsi sui migliori.
  // -------------------------------------------------------------------------
  const totalSlots = ROLES.reduce((a, r) => a + slots[r], 0);
  // Ogni squadra deve riempire tutti gli slot: 1 credito a testa e' spesa obbligata.
  const discretionary = Math.max(1, ctx.nParticipants * (ctx.budget - totalSlots));

  const marketWeight = new Map<string, number>();
  for (const role of ROLES) {
    const weighted = pool
      .filter((p) => p.role === role)
      .map((p) => ({
        id: p.id,
        w: Number(p.fvm ?? (p.quotation_initial ?? p.quotation_current ?? 1) * 8),
      }))
      .sort((a, b) => b.w - a.w);
    for (const x of weighted.slice(0, ctx.nParticipants * slots[role])) {
      marketWeight.set(x.id, Math.max(0, x.w));
    }
  }
  const marketWeightTotal = [...marketWeight.values()].reduce((a, b) => a + b, 0) || 1;
  const marketPriceOf = (id: string) =>
    Math.max(1, 1 + ((marketWeight.get(id) ?? 0) / marketWeightTotal) * discretionary);

  // -------------------------------------------------------------------------
  // Dove sta il giocatore "gratis".
  //
  // Fra l'ultimo titolare e l'ultimo slot di panchina c'e' un abisso di prezzo:
  // se il rimpiazzo e' l'ultimo titolare, i crediti si concentrano su una
  // sessantina di nomi; se e' l'ultimo panchinaro, si spalmano su tutti e il
  // top player non vale nulla. La verita' sta in mezzo, e quanto in mezzo e' una
  // proprieta' del formato d'asta, non dei singoli giocatori: la leggiamo dal
  // listino ufficiale, che nasce dai prezzi realmente pagati.
  // -------------------------------------------------------------------------
  const replacementIndex = (role: Role, bench: number) =>
    Math.max(
      1,
      Math.round(
        ctx.nParticipants * (STARTERS_PER_TEAM[role] + bench * (slots[role] - STARTERS_PER_TEAM[role])),
      ),
    );

  type VorPass = {
    vorById: Map<string, number>;
    replacementFM: RoleMap<number>;
    replacementMV: RoleMap<number>;
    modBonusById: Map<string, number>;
  };

  function computeVor(bench: number): VorPass {
    const vorById = new Map<string, number>();
    const modBonusById = new Map<string, number>();
    const replacementFM = {} as RoleMap<number>;
    const replacementMV = {} as RoleMap<number>;

    for (const role of ROLES) {
      const list = byRoleProj[role];
      const index = replacementIndex(role, bench);

      // Il rimpiazzo va cercato con la stessa metrica con cui poi lo
      // confrontiamo, cioe' la fantamedia: ordinare per punti stagionali e usare
      // il risultato come soglia di fantamedia mescola due scale, e fa finire al
      // posto del rimpiazzo un giocatore da tante presenze e poca resa.
      // Restano fuori i campioni troppo piccoli: il sostituto che trovi gratis e'
      // uno che gioca, non uno che ha fatto tre partite buone.
      const plausible = list.filter((p) => p.expApps >= 19);
      const ranked = (plausible.length >= index + 4 ? plausible : list)
        .slice()
        .sort((a, b) => b.expFM - a.expFM);

      // Media locale invece del singolo giocatore all'indice esatto: un solo
      // nome e' rumore, e sposterebbe il prezzo di tutto il reparto.
      const lo = Math.max(0, Math.min(index - 2, ranked.length - 1));
      const hi = Math.min(ranked.length - 1, index + 2);
      const window = ranked.slice(lo, hi + 1);
      const replFM = window.length
        ? window.reduce((a, p) => a + p.expFM, 0) / window.length
        : ROLE_BASELINE_FM[role];
      const replMV = window.length
        ? window.reduce((a, p) => a + p.expMV, 0) / window.length
        : ROLE_BASELINE_MV[role];
      replacementFM[role] = replFM;
      replacementMV[role] = replMV;

      const modOn = modifierApplies(role, ctx.rules);
      for (const proj of list) {
        // Il vantaggio del modificatore va misurato contro la media voto del
        // difensore che prenderesti gratis, non contro quella degli altri
        // titolari: altrimenti alzare tutto il reparto insieme lo annullerebbe.
        const modBonus = modOn ? DEF_MOD_SLOPE * Math.max(0, proj.expMV - replMV) : 0;
        modBonusById.set(proj.playerId, modBonus);
        const surplus = Math.max(0, proj.expFM - replFM) + modBonus;
        vorById.set(proj.playerId, (proj.expApps / 38) * surplus);
      }
    }
    return { vorById, replacementFM, replacementMV, modBonusById };
  }

  /** Quanto pesano i piu' cari sul totale: e' la misura di concentrazione. */
  const TOP_K = Math.max(10, Math.round(ctx.nParticipants * 2.5));
  const topSum = (values: number[]) =>
    values.sort((a, b) => b - a).slice(0, TOP_K).reduce((a, b) => a + b, 0);

  const marketTop = topSum(pool.map((p) => marketPriceOf(p.id)));

  /**
   * Il bersaglio della taratura, e quanti giocatori guarda.
   *
   * Con i prezzi di un'asta vera si guardano solo quelli — due o tre nomi, ma
   * veri — invece dei venti del listino. Senza, resta il listino: e' meglio di
   * niente, ma descrive un prezziario e non la tua lega.
   */
  const anchors = (ctx.topPrices?.prices ?? [])
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b - a);
  const scala =
    ctx.topPrices && ctx.topPrices.budget > 0 ? ctx.budget / ctx.topPrices.budget : 1;
  const obiettivo = anchors.length > 0 ? anchors.reduce((a, b) => a + b, 0) * scala : marketTop;
  const quanti = anchors.length > 0 ? anchors.length : TOP_K;
  const sommaPrimi = (values: number[]) =>
    values.sort((a, b) => b - a).slice(0, quanti).reduce((a, b) => a + b, 0);

  function modelTop(pass: VorPass): number {
    const total = [...pass.vorById.values()].reduce((a, b) => a + b, 0);
    const perVor = total > 0 ? discretionary / total : 0;
    return sommaPrimi(pool.map((p) => 1 + (pass.vorById.get(p.id) ?? 0) * perVor));
  }

  // Piu' panchina si include, piu' il prezzo si appiattisce: la funzione e'
  // monotona, quindi bastano una dozzina di bisezioni.
  let bench = 0.35; // valore di ripiego se il listino non dice niente di utile
  let pass = computeVor(bench);
  if (ctx.benchOverride != null) {
    bench = Math.min(1, Math.max(0, ctx.benchOverride));
    pass = computeVor(bench);
  } else if (obiettivo > 0 && (anchors.length > 0 || marketWeightTotal > 1)) {
    let lo = 0;
    let hi = 1;
    const atLo = modelTop(computeVor(lo));
    const atHi = modelTop(computeVor(hi));
    // Se nemmeno la concentrazione massima arriva al bersaglio, ci si ferma li'
    // e non si inventa: il modello dira' meno del vero, ma quello che dice sta
    // in piedi.
    if (atLo <= obiettivo) bench = 0;
    else if (atHi >= obiettivo) bench = 1;
    else {
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (modelTop(computeVor(mid)) > obiettivo) lo = mid;
        else hi = mid;
      }
      bench = (lo + hi) / 2;
    }
    pass = computeVor(bench);
  }

  const { vorById, replacementFM, replacementMV, modBonusById } = pass;
  for (const proj of projections) {
    proj.defModBonus = modBonusById.get(proj.playerId) ?? 0;
    proj.effFM = proj.expFM + proj.defModBonus;
    proj.seasonPoints = proj.expApps * proj.effFM;
  }

  const totalVOR = [...vorById.values()].reduce((a, b) => a + b, 0);
  const pricePerVOR = totalVOR > 0 ? discretionary / totalVOR : 0;

  const byPlayer = new Map<string, Valuation>();
  const byRole: RoleMap<Valuation[]> = { P: [], D: [], C: [], A: [] };

  for (const p of pool) {
    const proj = projById.get(p.id)!;
    const vor = vorById.get(p.id) ?? 0;
    const baseValue = Math.max(1, 1 + vor * pricePerVOR);
    const marketPrice = marketPriceOf(p.id);
    const val: Valuation = {
      ...proj,
      vor,
      baseValue,
      marketPrice,
      edgeVsMarket: baseValue / marketPrice,
      tier: tierOf(baseValue, ctx.budget),
      rankInRole: 0,
      teamStrength: teamStrength.get(p.team) ?? 0.5,
      rigorista: rigoristi.get(p.id),
    };
    byPlayer.set(p.id, val);
    byRole[p.role].push(val);
  }

  for (const role of ROLES) {
    // A parita' di prezzo (tutti i riempitivi valgono 1) ordiniamo per rendimento
    // atteso, altrimenti la "posizione nel ruolo" sarebbe casuale.
    byRole[role].sort((a, b) => b.baseValue - a.baseValue || b.seasonPoints - a.seasonPoints);
    byRole[role].forEach((v, i) => {
      v.rankInRole = i + 1;
    });
  }

  return {
    byPlayer,
    byRole,
    replacementFM,
    replacementMV,
    matchdaysPlayed,
    anchoredOnRealPrices: anchors.length > 0,
    benchDepth: bench,
    pricePerVOR,
    totalMarketValue: [...byPlayer.values()].reduce((a, v) => a + v.baseValue, 0),
  };
}

/**
 * Quanto pesa davvero ogni stagione nel calcolo di questo giocatore, in
 * percentuale. E' il numero onesto da mostrare: il peso nominale non basta,
 * perche' viene moltiplicato per le presenze effettive.
 */
export function seasonShares(
  history: PlayerStatsRow[],
  role: Role,
  opts: BlendOptions = {},
): Map<string, number> {
  const out = new Map<string, number>();
  const rows = normalizeHistory(history, role);
  if (rows.length === 0) return out;

  const current = opts.currentSeason
    ? (rows.find((r) => r.season === opts.currentSeason) ?? null)
    : null;
  const completed = rows
    .filter((r) => r.season !== opts.currentSeason)
    .slice(0, SEASON_WEIGHTS.length);

  const weights: [string, number][] = [];
  if (current) {
    weights.push([current.season, currentSeasonWeight(current.matches) * current.weightFactor]);
  }
  completed.forEach((r, i) =>
    weights.push([r.season, SEASON_WEIGHTS[i] * r.matches * r.weightFactor]),
  );

  const total = weights.reduce((a, [, w]) => a + w, 0);
  for (const [season, w] of weights) out.set(season, total > 0 ? w / total : 0);
  return out;
}
