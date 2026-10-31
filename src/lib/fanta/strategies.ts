import { ROLES, type LeagueRules, type Role, type RoleMap } from "./types";

export type StrategyKey =
  | "equilibrata"
  | "modificatore_difesa"
  | "attacco_forte"
  | "centrocampo_bonus"
  | "spalmata"
  | "portiere_top"
  | "custom";

export type StrategyDef = {
  key: StrategyKey;
  label: string;
  /** Frazione del budget destinata a ogni ruolo. La somma fa 1. */
  budgetSplit: RoleMap<number>;
  /** Quanti giocatori di fascia alta puntare per ruolo. */
  topTargets: RoleMap<number>;
  summary: string;
  /** Cosa la rende sensata. */
  pros: string[];
  cons: string[];
  /** La strategia ha senso solo se queste regole sono attive. */
  requires?: (rules: LeagueRules) => boolean;
  /** Quanto e' rischiosa: 1 = conservativa, 5 = tutto o niente. */
  risk: number;
};

/**
 * Quanto puo' pesare un giocatore solo, in quota del budget.
 *
 * Misurato sul listone vero, su tre strategie diverse: senza tetto il piano
 * mette quasi tutta la quota di un reparto sul primo nome e riempie il resto a
 * un credito (mediana 2, contro la mediana di 8 dell'asta vera). Con un tetto
 * al 14% fa **piu' punti** — 72.83 contro 72.33 su equilibrata, e altrettanto
 * sulle altre — perche' i punti li fa la formazione titolare, dove contano 3.6
 * difensori e 4.2 centrocampisti: una stella sola non li riempie.
 */
export const QUOTA_GIOCATORE_DEFAULT = 0.14;

export const STRATEGIES: StrategyDef[] = [
  {
    key: "equilibrata",
    label: "Equilibrata",
    budgetSplit: { P: 0.07, D: 0.16, C: 0.33, A: 0.44 },
    topTargets: { P: 1, D: 1, C: 2, A: 1 },
    summary:
      "Un top per reparto nevralgico, nessun buco. Reggi bene le assenze e non dipendi da un singolo.",
    pros: ["Poca varianza", "Ti tiene in corsa anche con due infortuni", "Facile da eseguire in asta"],
    cons: ["Difficilmente vinci il campionato di misura", "Nessun giocatore che ti risolve le giornate"],
    risk: 2,
  },
  {
    key: "attacco_forte",
    label: "Attacco corazzato",
    budgetSplit: { P: 0.05, D: 0.12, C: 0.28, A: 0.55 },
    topTargets: { P: 0, D: 0, C: 1, A: 2 },
    summary:
      "Due attaccanti da 15+ gol e il resto costruito con i saldi. In Classic il bonus gol pesa piu' di ogni altra cosa.",
    pros: [
      "Il gol e' il bonus piu' pagante e meno replicabile",
      "Due punte top ti fanno vincere le giornate da sole",
      "Gli attaccanti di fascia media si trovano a fine asta a prezzi bassi",
    ],
    cons: [
      "Difesa da rattoppare: se la lega ha il modificatore ti fa male",
      "Un infortunio a una punta ti azzoppa la stagione",
      "Richiede nervi saldi: devi arrivare in fondo con pochi crediti",
    ],
    risk: 4,
  },
  {
    key: "modificatore_difesa",
    label: "Modificatore di difesa",
    budgetSplit: { P: 0.11, D: 0.27, C: 0.29, A: 0.33 },
    topTargets: { P: 1, D: 3, C: 1, A: 1 },
    summary:
      "Blocco difensivo di una o due squadre forti piu' portiere titolare. Il modificatore vale 2-4 punti a giornata, quanto un attaccante da 20 gol.",
    pros: [
      "Il modificatore e' un bonus quasi garantito, non dipende dalla giornata storta",
      "I difensori costano poco rispetto a quanto rendono con il modificatore",
      "Blocco della stessa squadra: quando non prende gol ti porta a casa tutto insieme",
    ],
    cons: [
      "Serve un blocco vero: 4 difensori titolari di squadre solide, non basta comprarne uno",
      "Se la difesa che scegli crolla, hai speso un quarto del budget per niente",
      "Attacco necessariamente piu' povero",
    ],
    requires: (rules) => rules.defense_modifier,
    risk: 3,
  },
  {
    key: "centrocampo_bonus",
    label: "Centrocampo da bonus",
    budgetSplit: { P: 0.06, D: 0.14, C: 0.45, A: 0.35 },
    topTargets: { P: 0, D: 0, C: 3, A: 1 },
    summary:
      "Tre centrocampisti offensivi da doppia cifra fra gol e assist. Fasce piu' economiche degli attaccanti a parita' di bonus prodotti.",
    pros: [
      "I centrocampisti offensivi costano meno degli attaccanti a parita' di bonus",
      "Ne schieri 4-5 a giornata contro 2-3 attaccanti: piu' occasioni di bonus",
      "Se la lega da' l'assist, e' il reparto che ne produce di piu'",
    ],
    cons: [
      "Bonus meno concentrati: dipendi dalla continuita'",
      "Il mercato negli ultimi anni ha imparato a prezzarli, gli affari sono rari",
    ],
    risk: 3,
  },
  {
    key: "spalmata",
    label: "Spalmata (nessun top)",
    budgetSplit: { P: 0.07, D: 0.18, C: 0.37, A: 0.38 },
    topTargets: { P: 0, D: 0, C: 0, A: 0 },
    summary:
      "Nessun giocatore sopra il 12% del budget: undici titolari solidi e una panchina vera. Vive di rendita sulla profondita'.",
    pros: [
      "Immune agli infortuni: hai sempre un'alternativa titolare",
      "Sfrutti gli errori altrui: mentre loro si svenano sui top, tu compri il secondo livello",
      "Ottima in leghe numerose dove i top vanno all'asta a cifre folli",
    ],
    cons: [
      "Nessun giocatore che ti vince la giornata da solo",
      "Rischi di ritrovarti con tanti 6 e pochi bonus",
    ],
    risk: 2,
  },
  {
    key: "portiere_top",
    label: "Portiere top + difesa",
    budgetSplit: { P: 0.14, D: 0.22, C: 0.3, A: 0.34 },
    topTargets: { P: 1, D: 2, C: 1, A: 1 },
    summary:
      "Ha senso solo con il modificatore portiere o di difesa attivo: un portiere da 6.3 di media voto sposta il modificatore ogni singola giornata.",
    pros: [
      "Il portiere e' l'unico ruolo dove il titolare gioca sempre: zero rischio rotazione",
      "Con il modificatore attivo, la media voto del portiere vale piu' di due gol a stagione",
    ],
    cons: [
      "Senza modificatore e' budget sprecato: un portiere vale l'altro",
      "Se la squadra del portiere va in crisi difensiva, paghi doppio",
    ],
    requires: (rules) => rules.defense_modifier || rules.goalkeeper_modifier,
    risk: 3,
  },
];

export const STRATEGY_BY_KEY = new Map(STRATEGIES.map((s) => [s.key, s]));

export function availableStrategies(rules: LeagueRules): StrategyDef[] {
  return STRATEGIES.filter((s) => !s.requires || s.requires(rules));
}

export function getStrategy(key: string): StrategyDef | undefined {
  return STRATEGY_BY_KEY.get(key as StrategyKey);
}

export function normalizeSplit(split: Partial<RoleMap<number>>): RoleMap<number> {
  const out = {} as RoleMap<number>;
  let total = 0;
  for (const r of ROLES) {
    const v = Math.max(0, Number(split[r] ?? 0));
    out[r] = v;
    total += v;
  }
  if (total <= 0) return { P: 0.07, D: 0.16, C: 0.33, A: 0.44 };
  for (const r of ROLES) out[r] = out[r] / total;
  return out;
}

/**
 * Quanto la strategia si discosta dal mercato neutro per un dato ruolo.
 * Se il mercato spende il 15% in difesa e la mia strategia ne prevede il 27%,
 * per me ogni difensore vale 1.8 volte il suo prezzo di listino.
 */
export function strategyMultipliers(
  split: RoleMap<number>,
  neutralSplit: RoleMap<number>,
): RoleMap<number> {
  const out = {} as RoleMap<number>;
  for (const r of ROLES) {
    const neutral = neutralSplit[r] || 0.01;
    // Radice quadrata: la strategia inclina il prezzo, non lo stravolge.
    out[r] = clampMult(Math.sqrt(split[r] / neutral));
  }
  return out;
}

const clampMult = (v: number) => Math.min(1.45, Math.max(0.62, v));

/** Quanto vale ogni ruolo sul mercato, secondo i prezzi di equilibrio calcolati. */
export function neutralSplitFrom(valueByRole: RoleMap<number>): RoleMap<number> {
  const total = ROLES.reduce((a, r) => a + valueByRole[r], 0) || 1;
  const out = {} as RoleMap<number>;
  for (const r of ROLES) out[r] = valueByRole[r] / total;
  return out;
}

export type RoleShare = { role: Role; label: string; share: number; credits: number };
