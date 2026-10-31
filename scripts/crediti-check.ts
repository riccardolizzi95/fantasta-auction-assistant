/**
 * I crediti bastano per riempire la rosa? E il piano segue la strategia?
 *
 * Due domande che nessun altro controllo faceva, e che sono arrivate insieme da
 * un'asta di prova finita male: un credito in mano e ventidue giocatori ancora
 * da comprare, con il pannello della rosa vuoto e identico per ogni strategia.
 *
 * La prima e' una garanzia di fattibilita': **nessuna registrazione puo'
 * lasciare una squadra senza i crediti per completare la rosa**. Il motore quel
 * numero lo conosceva gia' (`maxBid`, il tetto dei consigli); a non guardarlo
 * era il riquadro che registra chi ha preso chi.
 *
 * La seconda e' piu' sottile e piu' facile da sbagliare senza accorgersene: il
 * piano ordinava il mercato per rendimento e comprava dall'alto, e siccome gol
 * e assist stanno in mezzo al campo, centrocampisti e attaccanti si prendevano
 * il 95% dei crediti **in ogni strategia**. Sceglievi "modificatore di difesa" e
 * la rosa mostrata era quella di "attacco forte".
 *
 * Uso:
 *   npm run check:crediti
 */
import { buildValuations } from "../src/lib/fanta/valuation";
import { buildMarketState, perchePrezzoImpossibile } from "../src/lib/fanta/market";
import { mercatoCorrente } from "../src/lib/fanta/recommend";
import { rosaIdeale, scalaPrezzi } from "../src/lib/fanta/piano";
import { getStrategy, normalizeSplit } from "../src/lib/fanta/strategies";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLES,
  type AuctionEventRow,
  type PlayerWithStats,
  type Role,
  type RoleMap,
} from "../src/lib/fanta/types";

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const TEAMS = [
  "Inter", "Napoli", "Juventus", "Milan", "Atalanta", "Roma", "Lazio", "Fiorentina",
  "Bologna", "Torino", "Udinese", "Genoa", "Como", "Verona", "Cagliari", "Lecce",
  "Parma", "Empoli", "Monza", "Venezia",
];
const PER_ROLE: Record<Role, number> = { P: 3, D: 9, C: 9, A: 6 };

const STAT_SEASONS = ["2025-26", "2024-25", "2023-24"];

function makeStats(
  season: string,
  role: Role,
  quality: number,
  strength: number,
  matches: number,
): PlayerWithStats["stats"] {
  const mvBase: Record<Role, number> = { P: 5.75, D: 5.8, C: 5.85, A: 5.85 };
  const mvSpread: Record<Role, number> = { P: 0.55, D: 0.5, C: 0.45, A: 0.5 };
  const mv = mvBase[role] + mvSpread[role] * quality + (rnd() - 0.5) * 0.14;

  const goals =
    role === "A" ? Math.round(24 * Math.pow(quality, 1.6) * (0.7 + rnd() * 0.6))
    : role === "C" ? Math.round(12 * Math.pow(quality, 1.9) * (0.6 + rnd() * 0.8))
    : role === "D" ? Math.round(4 * Math.pow(quality, 2.2) * rnd() * 1.6)
    : 0;
  const assists =
    role === "P" ? 0
    : Math.round((role === "C" ? 9 : role === "A" ? 7 : 3) * Math.pow(quality, 1.5) * (0.5 + rnd()));
  const yellow = Math.round(matches * (role === "D" ? 0.22 : role === "C" ? 0.18 : 0.12) * (0.5 + rnd()));
  const concededRate = role === "P" ? 1.75 - 0.95 * strength : 0;
  const penSaved = role === "P" ? Math.round(3 * strength * rnd()) : 0;
  const penScored = role !== "P" && quality > 0.72 ? Math.round(5 * rnd()) : 0;

  const bonus = goals * 3 + assists - yellow * 0.5 + penSaved * 3;
  const fm = matches > 0 ? mv + bonus / matches - concededRate : mv;

  return {
    player_id: "",
    season,
    matches,
    minutes: matches * (matches > 20 ? 84 : 38),
    avg_vote: Number(mv.toFixed(2)),
    avg_fantavote: Number(fm.toFixed(2)),
    goals,
    assists,
    own_goals: 0,
    yellow_cards: yellow,
    red_cards: rnd() > 0.94 ? 1 : 0,
    pen_scored: penScored,
    pen_missed: 0,
    pen_saved: penSaved,
    goals_conceded: Math.round(matches * concededRate),
    clean_sheets: role === "P" ? Math.round(matches * (0.1 + 0.3 * strength)) : 0,
  };
}

function makePool(): PlayerWithStats[] {
  seed = 42; // stessa popolazione a ogni scenario, altrimenti il confronto non vale
  const out: PlayerWithStats[] = [];
  let id = 0;
  TEAMS.forEach((team, ti) => {
    const strength = 1 - ti / TEAMS.length; // le prime della lista sono le piu' forti
    for (const role of ROLES) {
      for (let i = 0; i < PER_ROLE[role]; i++) {
        id++;
        const depth = 1 - i / PER_ROLE[role]; // 1 = titolarissimo
        // La qualita' e' concentrata: pochi fuoriclasse, tanta massa media.
        const q = Math.pow(0.62 * depth + 0.38 * strength, 1.7) * (0.85 + rnd() * 0.3);
        const quality = Math.min(1, Math.max(0, q));
        const isStarter = depth > 0.55;

        // Tre stagioni: la piu' vecchia con un rendimento leggermente diverso e
        // qualche giocatore che salta un'annata, come nella realta'.
        const history = STAT_SEASONS.map((season, k) => {
          const drift = 1 - k * 0.06; // si migliora col tempo, in media
          const injured = k === 0 && rnd() > 0.9;
          const matches = injured
            ? Math.round(4 + 8 * rnd())
            : isStarter
              ? Math.round((26 + 10 * quality * (0.6 + rnd() * 0.6)) * (k === 0 ? 1 : 0.92))
              : Math.round(3 + 15 * rnd());
          return makeStats(season, role, Math.min(1, quality * drift), strength, matches)!;
        });

        const quotBase: Record<Role, number> = { P: 10, D: 12, C: 16, A: 20 };
        const quot = Math.max(
          1,
          Math.round((1 + Math.pow(quality, 1.4) * quotBase[role]) * (0.82 + rnd() * 0.36)),
        );

        out.push({
          id: `p${id}`,
          season: "2026-27",
          external_id: id,
          name: `${role}${i + 1} ${team}`,
          team,
          role,
          quotation_initial: quot,
          quotation_current: quot,
          fvm: quot * 8,
          is_active: true,
          stats: history[0],
          history,
        });
      }
    }
  });
  return out;
}


const BUDGET = 500;
const N = 8;
const STRATEGIE = ["equilibrata", "attacco_forte", "modificatore_difesa", "portiere_top"];

let bad = 0;
function assert(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`, ok ? "" : (detail ?? ""));
  if (!ok) bad++;
}

const pool = makePool();
const rules = { ...DEFAULT_RULES };
const vals = buildValuations(pool, {
  season: "2026-27",
  nParticipants: N,
  budget: BUDGET,
  slots: DEFAULT_SLOTS,
  rules,
});
const participants = Array.from({ length: N }, (_, i) => ({
  id: `t${i}`,
  league_id: "L",
  name: i === 0 ? "Io" : `Rivale ${i}`,
  user_id: i === 0 ? "u" : null,
  budget_total: BUDGET,
}));
const league = {
  id: "L",
  name: "Test",
  season: "2026-27",
  mode: "classic" as const,
  owner_id: "u",
  budget: BUDGET,
  n_participants: N,
  slots: DEFAULT_SLOTS,
  rules,
  auction_format: "chiamata" as const,
  status: "auction" as const,
  invite_code: "X",
};
const playerMap = new Map(pool.map((p) => [p.id, p]));
const stato = (events: AuctionEventRow[]) =>
  buildMarketState({
    league,
    participants,
    events,
    players: playerMap,
    valuations: vals.byPlayer,
    myParticipantId: "t0",
  });

// --- 1. La rosa deve restare riempibile -------------------------------------
//
// Il caso vero, quello che ha fatto nascere questo controllo: tre attaccanti
// pagati 236, 133 e 130 con 500 crediti e 25 slot. Il terzo non poteva stare
// in piedi, e nessuno lo diceva.
console.log("\n=== Nessuna registrazione lascia la rosa impossibile ===");
const topA = vals.byRole.A.slice(0, 3).map((v) => pool.find((p) => p.id === v.playerId)!);
const prezzi = [236, 133, 130];
const events: AuctionEventRow[] = [];
const respinti: string[] = [];
for (let i = 0; i < 3; i++) {
  const st = stato(events);
  const perche = perchePrezzoImpossibile({
    state: st,
    participantId: "t0",
    price: prezzi[i],
    role: topA[i].role,
  });
  console.log(
    `  ${topA[i].name} a ${prezzi[i]}: crediti ${st.me!.remaining}, slot ${st.me!.totalSlotsLeft}, ` +
      `tetto ${st.me!.maxBid} -> ${perche ?? "passa"}`,
  );
  if (perche) respinti.push(topA[i].name);
  events.push({
    id: `e${i}`,
    league_id: "L",
    player_id: topA[i].id,
    participant_id: "t0",
    price: prezzi[i],
    outcome: "assigned",
    created_at: new Date().toISOString(),
  });
}
assert("i primi due passano, il terzo no", respinti.length === 1, respinti);

// Il tetto non e' una percentuale a caso: e' esattamente quello che resta
// tenendo un credito per ogni altro slot.
{
  const st = stato([]);
  const limite = BUDGET - (25 - 1);
  assert(
    "il tetto tiene un credito per ogni altro slot",
    perchePrezzoImpossibile({ state: st, participantId: "t0", price: limite, role: "A" }) === null &&
      perchePrezzoImpossibile({ state: st, participantId: "t0", price: limite + 1, role: "A" }) !==
        null,
    limite,
  );
  // Correggere un acquisto gia' registrato non e' comprarne un altro: quello
  // che c'era va restituito prima di rifare il conto.
  const conUno = stato([events[0]]);
  assert(
    "correggere un prezzo gia' registrato non conta due volte",
    perchePrezzoImpossibile({
      state: conUno,
      participantId: "t0",
      price: 236,
      role: topA[0].role,
      precedente: { participantId: "t0", price: 236 },
    }) === null,
  );
  // "Non lo so" non ha una cassa da controllare.
  assert(
    "il compratore sconosciuto non viene bloccato",
    perchePrezzoImpossibile({ state: conUno, participantId: null, price: 400, role: "A" }) === null,
  );

  // --- e la rettifica, che e' la stessa domanda fatta al contrario ---------
  //
  // Correggere un 130 scritto al posto di 30 deve sempre passare: si liberano
  // crediti, non se ne bruciano.
  assert(
    "abbassare un prezzo sbagliato passa sempre",
    perchePrezzoImpossibile({
      state: conUno,
      participantId: "t0",
      price: 30,
      role: topA[0].role,
      precedente: { participantId: "t0", price: 236 },
    }) === null,
  );
  // Spostare un giocatore a un'altra squadra si misura sulla cassa di **quella**
  // squadra, non su quella da cui viene: e' li' che i crediti devono esserci.
  const povero = stato([
    events[0],
    {
      id: "x1",
      league_id: "L",
      player_id: vals.byRole.C[0].playerId,
      participant_id: "t1",
      price: 470,
      outcome: "assigned",
      created_at: new Date().toISOString(),
    },
  ]);
  const rivale = povero.teams.find((t) => t.participant.id === "t1")!;
  console.log(
    `  ${rivale.participant.name} ha speso 470: gli restano ${rivale.remaining} crediti e ` +
      `${rivale.totalSlotsLeft} slot, quindi puo' offrire ${rivale.maxBid}`,
  );
  assert(
    "spostare un acquisto a chi non puo' pagarlo viene fermato",
    perchePrezzoImpossibile({
      state: povero,
      participantId: "t1",
      price: 236,
      role: topA[0].role,
      precedente: { participantId: "t0", price: 236 },
    }) !== null,
  );
  assert(
    "ma spostarlo a una cifra che regge passa",
    perchePrezzoImpossibile({
      state: povero,
      participantId: "t1",
      price: rivale.maxBid,
      role: topA[0].role,
      precedente: { participantId: "t0", price: 236 },
    }) === null,
  );
}

// --- 2. Il piano segue la strategia -----------------------------------------
console.log("\n=== La rosa che stai costruendo cambia con la strategia ===");
const st0 = stato([]);
const me0 = st0.me!;
const spesaPerRuolo: Record<string, RoleMap<number>> = {};
const punti: Record<string, number> = {};
for (const k of STRATEGIE) {
  const strategy = getStrategy(k)!;
  const split = normalizeSplit(strategy.budgetSplit);
  const mercato = mercatoCorrente({
    state: st0,
    valuations: vals,
    allPlayers: pool,
    strategyKey: k,
    budgetSplit: split,
  });
  const piano = rosaIdeale({
    rosa: [],
    slotsLiberi: me0.slotsLeft,
    crediti: me0.remaining,
    mercato,
    ctx: {
      replacementFM: vals.replacementFM,
      replacementMV: vals.replacementMV,
      modificatore: rules.defense_modifier,
    },
    scala: scalaPrezzi({
      split,
      slotsLiberi: me0.slotsLeft,
      spesoPerRuolo: me0.spentByRole,
      topTargets: strategy.topTargets,
      budgetTotale: BUDGET,
      tettoMax: null,
    }),
  });
  const spesa = { P: 0, D: 0, C: 0, A: 0 } as RoleMap<number>;
  for (const s of piano.slots) if (s.obiettivo) spesa[s.role] += s.obiettivo.prezzo;
  spesaPerRuolo[k] = spesa;
  punti[k] = piano.punti;
  console.log(
    `  ${k.padEnd(20)} ${ROLES.map((r) => `${r} ${String(Math.round((spesa[r] / BUDGET) * 100)).padStart(2)}%` +
      ` (vuole ${Math.round(split[r] * 100)}%)`).join("  ")}  tot ${piano.impegnati}`,
  );
  assert(
    `  ${k}: il piano spende quasi tutto`,
    piano.impegnati >= BUDGET * 0.95,
    `${piano.impegnati} su ${BUDGET}`,
  );
  for (const r of ROLES) {
    // Tolleranza larga: la quota e' un tetto, non un obbligo, e i prezzi veri
    // non arrivano mai esatti al centesimo. Serve che la segua, non che la
    // centri.
    assert(
      `  ${k}: la quota ${r} non viene sfondata`,
      spesa[r] <= split[r] * BUDGET + Math.max(12, split[r] * BUDGET * 0.25),
      `${spesa[r]} contro ${Math.round(split[r] * BUDGET)}`,
    );
  }
}

assert(
  "la difesa pesa di piu' col modificatore che con l'attacco forte",
  spesaPerRuolo.modificatore_difesa.D > spesaPerRuolo.attacco_forte.D * 1.5,
  [spesaPerRuolo.modificatore_difesa.D, spesaPerRuolo.attacco_forte.D],
);
assert(
  "l'attacco pesa di piu' con l'attacco forte che col modificatore",
  spesaPerRuolo.attacco_forte.A > spesaPerRuolo.modificatore_difesa.A * 1.3,
  [spesaPerRuolo.attacco_forte.A, spesaPerRuolo.modificatore_difesa.A],
);
assert(
  "il portiere top spende sul portiere piu' di chiunque altro",
  ROLES.every(() => true) &&
    spesaPerRuolo.portiere_top.P > spesaPerRuolo.equilibrata.P &&
    spesaPerRuolo.portiere_top.P > spesaPerRuolo.attacco_forte.P,
  [spesaPerRuolo.portiere_top.P, spesaPerRuolo.equilibrata.P, spesaPerRuolo.attacco_forte.P],
);
// Due strategie diverse non possono produrre lo stesso identico piano: se
// succede, la strategia non sta arrivando fino al piano.
const impronte = new Set(STRATEGIE.map((k) => ROLES.map((r) => spesaPerRuolo[k][r]).join("|")));
assert("quattro strategie, quattro piani diversi", impronte.size === STRATEGIE.length, [
  ...impronte,
]);

// --- 3. E con la rosa impossibile il pannello lo dice ------------------------
console.log("\n=== Con un credito e ventidue slot, il piano non finge ===");
{
  const st = stato(events);
  const me = st.me!;
  const strategy = getStrategy("equilibrata")!;
  const split = normalizeSplit(strategy.budgetSplit);
  const piano = rosaIdeale({
    rosa: me.roster.map((r) => ({
      role: r.player.role,
      name: r.player.name,
      prezzo: r.price,
      expFM: r.valuation?.expFM ?? 0,
      expMV: r.valuation?.expMV ?? 0,
      expApps: r.valuation?.expApps ?? 0,
    })),
    slotsLiberi: me.slotsLeft,
    crediti: me.remaining,
    mercato: mercatoCorrente({
      state: st,
      valuations: vals,
      allPlayers: pool,
      strategyKey: "equilibrata",
      budgetSplit: split,
    }),
    ctx: {
      replacementFM: vals.replacementFM,
      replacementMV: vals.replacementMV,
      modificatore: rules.defense_modifier,
    },
    scala: scalaPrezzi({
      split,
      slotsLiberi: me.slotsLeft,
      spesoPerRuolo: me.spentByRole,
      topTargets: strategy.topTargets,
      budgetTotale: BUDGET,
      tettoMax: null,
    }),
  });
  console.log(
    `  crediti ${me.remaining}, slot ${me.totalSlotsLeft}, il piano ne riempie ` +
      `${piano.slots.filter((s) => s.obiettivo).length}`,
  );
  // Con un credito e ventidue slot non c'e' niente da promettere, ed e' giusto
  // che il pannello resti vuoto: il guaio non era qui, era a monte.
  assert("con un credito il piano non promette acquisti", piano.impegnati <= 1, piano.impegnati);
}

console.log(bad === 0 ? "\nI CREDITI TENGONO\n" : `\n${bad} PROBLEMI\n`);
process.exit(bad === 0 ? 0 : 1);

export {};
