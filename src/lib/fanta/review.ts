import type { MarketState } from "./market";
import { availableStrategies, getStrategy, normalizeSplit, type StrategyDef } from "./strategies";
import {
  ROLES,
  ROLE_LABEL,
  ROLE_PLURAL,
  STARTERS_PER_TEAM,
  type PlayerRow,
  type Role,
  type RoleMap,
} from "./types";
import { clamp, type Valuation, type ValuationResult } from "./valuation";

export type SimPick = {
  playerId: string;
  name: string;
  team: string;
  price: number;
  effFM: number;
  expApps: number;
};

export type StrategySim = {
  key: string;
  label: string;
  summary: string;
  risk: number;
  /** Punti fanta attesi a giornata dalla formazione titolare, a fine asta. */
  projectedPoints: number;
  /**
   * Quanto quella formazione rende IN PIU' di una fatta tutta di giocatori da 1
   * credito. E' l'unico numero che distingue davvero una strategia dall'altra:
   * i punti assoluti sono quasi tutti "pavimento" comune a ogni scelta.
   */
  surplusPoints: number;
  feasible: boolean;
  budgetByRole: RoleMap<number>;
  picks: RoleMap<SimPick[]>;
  warnings: string[];
};

export type StrategyReview = {
  ranked: StrategySim[];
  active: StrategySim | null;
  best: StrategySim | null;
  /** Proposta di cambio, popolata solo se conviene davvero. */
  suggestion: {
    fromKey: string | null;
    toKey: string;
    toLabel: string;
    gain: number;
    severity: "info" | "warn" | "critical";
    reason: string;
    shifts: { role: Role; from: number; to: number }[];
  } | null;
  budgetHealth: {
    remaining: number;
    slotsLeft: number;
    avgPerSlot: number;
    /** Crediti spendibili oltre il minimo di 1 per slot. */
    discretionary: number;
    status: "ok" | "tight" | "critical";
    message: string;
  };
};

/**
 * Il confronto quando non c'e' niente da confrontare.
 *
 * Serve in due casi che sembrano diversi e non lo sono: chi guarda l'asta senza
 * essere un partecipante, e chi non ha il premium — per il quale le valutazioni
 * non vengono nemmeno calcolate. In entrambi i casi la risposta onesta e' la
 * stessa, e averla come costante evita di inventarne due.
 */
export const REVIEW_VUOTA: StrategyReview = {
  ranked: [],
  active: null,
  best: null,
  suggestion: null,
  budgetHealth: {
    remaining: 0,
    slotsLeft: 0,
    avgPerSlot: 0,
    discretionary: 0,
    status: "ok",
    message: "Collega il tuo partecipante alla lega per vedere l'analisi.",
  },
};

/**
 * Simula come finirebbe l'asta se da qui in avanti seguissi una data strategia,
 * usando i giocatori ancora liberi e i prezzi che il mercato sta praticando adesso.
 */
function simulate(
  strategy: StrategyDef,
  state: MarketState,
  valuations: ValuationResult,
  available: PlayerRow[],
): StrategySim {
  const me = state.me!;
  const split = normalizeSplit(strategy.budgetSplit);
  const warnings: string[] = [];

  const slotsLeft = { ...me.slotsLeft };
  const totalSlotsLeft = ROLES.reduce((a, r) => a + slotsLeft[r], 0);
  const feasible = me.remaining >= totalSlotsLeft;
  if (!feasible) warnings.push("Non ti bastano i crediti per riempire tutti gli slot.");

  // Budget residuo da destinare a ogni ruolo secondo la strategia, riscalato su
  // quello che mi resta davvero in cassa.
  const rawBudget = {} as RoleMap<number>;
  let rawTotal = 0;
  for (const r of ROLES) {
    const planned = split[r] * me.participant.budget_total - me.spentByRole[r];
    const floor = slotsLeft[r]; // almeno 1 credito per slot
    rawBudget[r] = Math.max(floor, planned);
    rawTotal += rawBudget[r];
  }
  const budgetByRole = {} as RoleMap<number>;
  for (const r of ROLES) {
    budgetByRole[r] = rawTotal > 0 ? (rawBudget[r] / rawTotal) * me.remaining : 0;
  }

  const byRoleAvailable: RoleMap<{ p: PlayerRow; v: Valuation }[]> = { P: [], D: [], C: [], A: [] };
  for (const p of available) {
    const v = valuations.byPlayer.get(p.id);
    if (!v) continue;
    byRoleAvailable[p.role].push({ p, v });
  }
  for (const r of ROLES) {
    byRoleAvailable[r].sort((a, b) => b.v.seasonPoints - a.v.seasonPoints);
  }

  const picks: RoleMap<SimPick[]> = { P: [], D: [], C: [], A: [] };

  for (const r of ROLES) {
    let purse = budgetByRole[r];
    let need = slotsLeft[r];
    for (const { p, v } of byRoleAvailable[r]) {
      if (need <= 0) break;
      const price = Math.max(1, Math.round(v.baseValue * state.inflationByRole[r]));
      // Devo tenere 1 credito per ogni slot che resta dopo questo.
      if (price > purse - (need - 1)) continue;
      picks[r].push({
        playerId: p.id,
        name: p.name,
        team: p.team,
        price,
        effFM: v.effFM,
        expApps: v.expApps,
      });
      purse -= price;
      need -= 1;
    }
    if (need > 0) {
      // Riempio con giocatori da 1 credito: valgono il livello di rimpiazzo.
      for (let i = 0; i < need; i++) {
        picks[r].push({
          playerId: `filler-${r}-${i}`,
          name: "(riempitivo da 1)",
          team: "-",
          price: 1,
          effFM: valuations.replacementFM[r] - 0.15,
          expApps: 22,
        });
      }
    }
  }

  // Punti attesi della formazione titolare: chi non gioca viene sostituito da un
  // giocatore di livello rimpiazzo, quindi pesiamo per la titolarita'.
  let projectedPoints = 0;
  for (const r of ROLES) {
    const owned = me.roster
      .filter((x) => x.player.role === r)
      .map((x) => {
        const v = valuations.byPlayer.get(x.player.id);
        return { effFM: v?.effFM ?? valuations.replacementFM[r], expApps: v?.expApps ?? 22 };
      });
    const pool = [...owned, ...picks[r].map((x) => ({ effFM: x.effFM, expApps: x.expApps }))].sort(
      (a, b) => b.effFM - a.effFM,
    );
    let remainingSlots = STARTERS_PER_TEAM[r];
    for (const player of pool) {
      if (remainingSlots <= 0) break;
      const weight = Math.min(1, remainingSlots);
      const availability = clamp(player.expApps / 34, 0, 1);
      const value =
        availability * player.effFM + (1 - availability) * (valuations.replacementFM[r] - 0.2);
      projectedPoints += weight * value;
      remainingSlots -= 1;
    }
  }

  let baselinePoints = 0;
  for (const r of ROLES) {
    baselinePoints += STARTERS_PER_TEAM[r] * (valuations.replacementFM[r] - 0.2);
  }

  return {
    key: strategy.key,
    label: strategy.label,
    summary: strategy.summary,
    risk: strategy.risk,
    projectedPoints,
    surplusPoints: projectedPoints - baselinePoints,
    feasible,
    budgetByRole,
    picks,
    warnings,
  };
}

export function reviewStrategies(args: {
  state: MarketState;
  valuations: ValuationResult;
  allPlayers: PlayerRow[];
  activeKey: string | null;
}): StrategyReview {
  const { state, valuations, allPlayers, activeKey } = args;
  const me = state.me;

  if (!me) return REVIEW_VUOTA;

  const available = allPlayers.filter((p) => !state.takenPlayerIds.has(p.id));
  const candidates = availableStrategies(state.league.rules);
  const ranked = candidates
    .map((s) => simulate(s, state, valuations, available))
    .sort((a, b) => b.surplusPoints - a.surplusPoints);

  const active = ranked.find((s) => s.key === activeKey) ?? null;
  const best = ranked[0] ?? null;

  // Prima che l'asta produca dati veri, cambiare piano sarebbe solo rumore: la
  // classifica delle strategie resta visibile, ma senza allarme.
  const enoughSignal = state.eventsAssigned >= 5;

  let suggestion: StrategyReview["suggestion"] = null;
  if (enoughSignal && best && active && best.key !== active.key) {
    const gain = best.surplusPoints - active.surplusPoints;
    const gainPct = active.surplusPoints > 0 ? gain / active.surplusPoints : gain > 0 ? 1 : 0;
    // Sotto il 7% di guadagno non vale la pena riscrivere il piano a meta' asta.
    if (gainPct >= 0.07 && gain >= 0.12) {
      const activeDef = getStrategy(active.key)!;
      const bestDef = getStrategy(best.key)!;
      const shifts = ROLES.map((r) => ({
        role: r,
        from: Math.round(normalizeSplit(activeDef.budgetSplit)[r] * 100),
        to: Math.round(normalizeSplit(bestDef.budgetSplit)[r] * 100),
      })).filter((s) => Math.abs(s.to - s.from) >= 4);

      suggestion = {
        fromKey: active.key,
        toKey: best.key,
        toLabel: best.label,
        gain: Math.round(gain * 100) / 100,
        severity: gainPct >= 0.08 ? "critical" : gainPct >= 0.05 ? "warn" : "info",
        reason: buildReason(active, best, shifts, state, gain),
        shifts,
      };
    }
  }

  const slotsLeft = me.totalSlotsLeft;
  const discretionary = me.remaining - slotsLeft;
  const avgPerSlot = slotsLeft > 0 ? me.remaining / slotsLeft : 0;
  let status: "ok" | "tight" | "critical" = "ok";
  let message = `Ti restano ${me.remaining} crediti per ${slotsLeft} slot: ${avgPerSlot.toFixed(1)} di media.`;
  if (me.remaining < slotsLeft) {
    status = "critical";
    message = `Hai ${me.remaining} crediti ma ${slotsLeft} slot da riempire: non completi la rosa.`;
  } else if (discretionary < slotsLeft * 0.6) {
    status = "tight";
    message = `Ti restano solo ${discretionary} crediti oltre il minimo: da qui in poi caccia agli svincolati.`;
  }

  return {
    ranked,
    active,
    best,
    suggestion,
    budgetHealth: { remaining: me.remaining, slotsLeft, avgPerSlot, discretionary, status, message },
  };
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function buildReason(
  active: StrategySim,
  best: StrategySim,
  shifts: { role: Role; from: number; to: number }[],
  state: MarketState,
  gain: number,
): string {
  const me = state.me!;
  const parts: string[] = [];

  const hot = ROLES.filter((r) => state.inflationByRole[r] >= 1.12);
  const cold = ROLES.filter((r) => state.inflationByRole[r] <= 0.92);
  if (hot.length) {
    parts.push(`${listOf(hot.map((r) => ROLE_PLURAL[r]))} si stanno pagando sopra il valore`);
  }
  if (cold.length) {
    parts.push(`${listOf(cold.map((r) => ROLE_PLURAL[r]))} vanno via a sconto`);
  }
  parts.push(`ti restano ${me.remaining} crediti per ${me.totalSlotsLeft} slot`);

  const shiftText = shifts
    .map((s) => `${ROLE_LABEL[s.role]} ${s.from}% -> ${s.to}%`)
    .join(", ");

  return `Con "${active.label}" guadagneresti ${active.surplusPoints.toFixed(1)} punti a giornata sopra una rosa da 1 credito; con "${best.label}" ne guadagneresti ${best.surplusPoints.toFixed(1)} (+${gain.toFixed(1)}). Motivo: ${parts.join(", ")}.${shiftText ? ` Sposteresti il budget cosi': ${shiftText}.` : ""}`;
}
