/**
 * Controllo di sanita' del motore: genera un listone sintetico con una
 * distribuzione realistica di quotazioni e rendimenti, poi verifica che i prezzi
 * calcolati stiano nei range che ci si aspetta a un'asta da 500 crediti.
 */
import { buildValuations } from "../src/lib/fanta/valuation";
import { buildMarketState } from "../src/lib/fanta/market";
import { recommend } from "../src/lib/fanta/recommend";
import { reviewStrategies } from "../src/lib/fanta/review";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLES,
  type PlayerWithStats,
  type Role,
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

function run(label: string, defenseModifier: boolean) {
  const pool = makePool();
  const budget = 500;
  const n = 8;
  const rules = { ...DEFAULT_RULES, defense_modifier: defenseModifier };
  const vals = buildValuations(pool, { season: "2026-27", nParticipants: n, budget, slots: DEFAULT_SLOTS, rules });

  console.log(`\n=== ${label} (${pool.length} giocatori, ${n} squadre, ${budget} crediti) ===`);
  let rosterableSum = 0;
  for (const r of ROLES) {
    const top = vals.byRole[r].slice(0, 5);
    const rosterable = vals.byRole[r].slice(0, n * DEFAULT_SLOTS[r]);
    rosterableSum += rosterable.reduce((a, v) => a + v.baseValue, 0);
    const share = rosterable.reduce((a, v) => a + v.baseValue, 0);
    console.log(
      `${r}  quota reparto ${((share / (n * budget)) * 100).toFixed(1)}%  rimpiazzo FM ${vals.replacementFM[r].toFixed(2)}`,
    );
    console.log(
      "   " +
        top
          .map((v) => {
            const p = pool.find((x) => x.id === v.playerId)!;
            return `${p.name.padEnd(14)} ${Math.round(v.baseValue).toString().padStart(3)}cr`;
          })
          .join("  "),
    );
  }
  console.log(
    `Somma valori dei ${n * 25} acquistabili: ${Math.round(rosterableSum)} cr su ${n * budget} disponibili`,
  );
  return { pool, vals, rules, budget, n };
}

run("Senza modificatore di difesa", false);
const b = run("Con modificatore di difesa", true);

// --- Consiglio su un singolo giocatore, ad asta appena iniziata -------------
const { pool, vals, budget, n } = b;
const participants = Array.from({ length: n }, (_, i) => ({
  id: `t${i}`,
  league_id: "L",
  name: i === 0 ? "Io" : `Rivale ${i}`,
  user_id: i === 0 ? "u" : null,
  budget_total: budget,
}));
const league = {
  id: "L", name: "Test", season: "2026-27", mode: "classic" as const, owner_id: "u",
  budget, n_participants: n, slots: DEFAULT_SLOTS, rules: b.rules,
  auction_format: "chiamata" as const, status: "auction" as const, invite_code: "X",
};
const playerMap = new Map(pool.map((p) => [p.id, p]));

// Simuliamo un'asta gia' avviata: i rivali hanno pagato il 30% sopra il valore.
const topA = vals.byRole.A.slice(0, 6);
const events = topA.map((v, i) => ({
  id: `e${i}`, league_id: "L", player_id: v.playerId,
  participant_id: `t${(i % (n - 1)) + 1}`,
  price: Math.round(v.baseValue * 1.3), outcome: "assigned" as const,
  created_at: new Date().toISOString(),
}));

const state = buildMarketState({ league, participants, events, players: playerMap, valuations: vals.byPlayer, myParticipantId: "t0" });
console.log(`\n=== Dopo 6 attaccanti top pagati +30% ===`);
console.log(`Inflazione globale ${state.inflation.toFixed(2)} | per ruolo:`,
  ROLES.map((r) => `${r} ${state.inflationByRole[r].toFixed(2)}`).join("  "));

const candidate = pool.find((p) => p.id === vals.byRole.A[6].playerId)!;
for (const strat of ["attacco_forte", "modificatore_difesa"]) {
  const rec = recommend({ player: candidate, state, valuations: vals, allPlayers: pool, strategyKey: strat });
  console.log(`\n[${strat}] ${candidate.name}: valore ${rec.breakdown.baseValue} -> giusto ${rec.fair}, apri ${rec.target}, max ${rec.max} — ${rec.verdict}`);
  console.log(`  ${rec.headline}`);
  console.log(`  pro: ${rec.pros.slice(0, 2).join(" | ") || "-"}`);
  console.log(`  contro: ${rec.cons.slice(0, 2).join(" | ") || "-"}`);
}

const review = reviewStrategies({ state, valuations: vals, allPlayers: pool, activeKey: "attacco_forte" });
console.log(`\n=== Ritaratura strategia (attiva: attacco_forte) ===`);
for (const s of review.ranked) console.log(`  ${s.label.padEnd(26)} +${s.surplusPoints.toFixed(2)} punti/giornata sopra la rosa da 1 credito (assoluti ${s.projectedPoints.toFixed(1)})`);
console.log(review.suggestion ? `\nPROPOSTA: ${review.suggestion.reason}` : "\nNessun cambio consigliato.");
console.log(`Cassa: ${review.budgetHealth.message}`);

// ===========================================================================
// Asta a campionato gia' iniziato: cosa succede con due giornate in archivio
// ===========================================================================
/**
 * La taratura sui prezzi veri dell'asta.
 *
 * Il modello tarava la concentrazione sul listino ufficiale, che e' un
 * prezziario: dice quanto un giocatore vale, non quanto la gente paga. Misurato
 * sui dati veri, il piu' caro valeva 141 crediti su un budget di 500 mentre in
 * quella lega Lautaro Martinez era andato a 240 — meno della meta'. Chi seguiva
 * il modello perdeva tutti i top e restava con i crediti in mano.
 */
function ancoreScenario() {
  console.log("\n=== Taratura sui prezzi veri invece che sul listino ===");
  const pool = makePool();
  const budget = 500;
  const n = 8;
  const comune = { season: "2026-27", nParticipants: n, budget, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES };

  const conListino = buildValuations(pool, comune);
  const conAncore = buildValuations(pool, {
    ...comune,
    topPrices: { prices: [280, 240], budget: 500 },
  });

  const ordina = (v: ReturnType<typeof buildValuations>) =>
    [...v.byPlayer.values()].sort((a, b) => b.baseValue - a.baseValue);
  const a = ordina(conListino);
  const b = ordina(conAncore);
  const somma = (x: typeof a) => x.reduce((s, v) => s + v.baseValue, 0);

  let bad = 0;
  const assert = (label: string, ok: boolean, detail?: unknown) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`, ok ? "" : (detail ?? ""));
    if (!ok) bad++;
  };

  console.log(
    `  il piu' caro: ${Math.round(a[0].baseValue)} col listino -> ${Math.round(b[0].baseValue)} con i prezzi veri`,
  );
  assert("i prezzi veri alzano il piu' caro", b[0].baseValue > a[0].baseValue * 1.2, [
    Math.round(a[0].baseValue),
    Math.round(b[0].baseValue),
  ]);
  assert(
    "e lo avvicinano a quanto e' stato pagato davvero",
    b[0].baseValue >= 180,
    Math.round(b[0].baseValue),
  );
  // Il gioco e' a somma zero: i crediti in palio sono gli stessi, cambia solo
  // come si distribuiscono. Se i top salgono, qualcun altro deve scendere.
  assert(
    "i crediti distribuiti restano gli stessi",
    Math.abs(somma(b) - somma(a)) / somma(a) < 0.02,
    [Math.round(somma(a)), Math.round(somma(b))],
  );
  const meta = Math.floor(a.length / 2);
  assert(
    "e chi sta a meta' classifica costa meno di prima",
    b[meta].baseValue <= a[meta].baseValue,
    [Math.round(a[meta].baseValue), Math.round(b[meta].baseValue)],
  );
  assert("l'ordine dei migliori non cambia", b[0].playerId === a[0].playerId);
  console.log(bad === 0 ? "  Taratura: coerente" : `  Taratura: ${bad} problemi`);
  return bad;
}

function currentSeasonScenario() {
  console.log("\n=== Asta dopo 2 giornate del 2026/27 ===");
  const before = makePool();
  const budget = 500;
  const n = 8;
  const rules = { ...DEFAULT_RULES };
  const valsBefore = buildValuations(before, {
    season: "2026-27", nParticipants: n, budget, slots: DEFAULT_SLOTS, rules,
  });

  // Prendiamo tre casi limite fra gli attaccanti.
  const hotId = valsBefore.byRole.A[20].playerId;   // gregario con partenza sparata
  const starId = valsBefore.byRole.A[0].playerId;   // top che non e' ancora sceso in campo
  const steadyId = valsBefore.byRole.A[3].playerId; // top che gioca normalmente

  const after = before.map((p) => {
    let cur;
    if (p.id === hotId) {
      // 5 gol in 2 partite: fantamedia da 15, cioe' rumore travestito da dato
      cur = makeStats("2026-27", p.role, 1, 1, 2)!;
      cur.goals = 5; cur.avg_vote = 8.25; cur.avg_fantavote = 15.5; cur.assists = 0;
    } else if (p.id === starId) {
      // infortunato o fuori rosa: zero presenze
      cur = null;
    } else if (p.id === steadyId) {
      cur = makeStats("2026-27", p.role, 0.8, 1, 2)!;
      cur.goals = 1; cur.avg_vote = 6.5; cur.avg_fantavote = 8.0;
    } else {
      cur = makeStats("2026-27", p.role, 0.5, 0.5, rnd() > 0.25 ? 2 : 1)!;
    }
    return cur ? { ...p, history: [cur, ...p.history], stats: cur } : p;
  });

  const valsAfter = buildValuations(after, {
    season: "2026-27", nParticipants: n, budget, slots: DEFAULT_SLOTS, rules,
  });
  console.log(`Giornate rilevate: ${valsAfter.matchdaysPlayed}`);

  const show = (id: string, label: string) => {
    const b = valsBefore.byPlayer.get(id)!;
    const a = valsAfter.byPlayer.get(id)!;
    const p = before.find((x) => x.id === id)!;
    console.log(
      `  ${label.padEnd(34)} ${p.name.padEnd(13)} ` +
        `FM ${b.expFM.toFixed(2)} -> ${a.expFM.toFixed(2)}  ` +
        `pres ${Math.round(b.expApps)} -> ${Math.round(a.expApps)}  ` +
        `prezzo ${Math.round(b.baseValue)} -> ${Math.round(a.baseValue)}`,
    );
    return { b, a };
  };

  const hot = show(hotId, "partenza sparata (5 gol in 2)");
  const star = show(starId, "top mai sceso in campo");
  const steady = show(steadyId, "top che gioca normalmente");

  let bad = 0;
  const assert = (label: string, ok: boolean, detail?: unknown) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`, ok ? "" : (detail ?? ""));
    if (!ok) bad++;
  };
  assert("le giornate giocate vengono dedotte dai dati", valsAfter.matchdaysPlayed === 2);
  assert(
    "una doppietta iniziale non gonfia la fantamedia di piu' di 0.5",
    hot.a.expFM - hot.b.expFM < 0.5,
    (hot.a.expFM - hot.b.expFM).toFixed(2),
  );
  assert("ma un po' lo premia", hot.a.expFM > hot.b.expFM);
  assert(
    "chi parte bene e gioca sempre sale nelle presenze attese",
    hot.a.expApps > hot.b.expApps,
    [hot.b.expApps, hot.a.expApps],
  );
  assert(
    "il top mai sceso in campo perde presenze attese",
    star.a.expApps < star.b.expApps - 3,
    [star.b.expApps.toFixed(1), star.a.expApps.toFixed(1)],
  );

  // Il prezzo e' sempre relativo a tutto il mercato: fra due calcoli diversi
  // cambia il metro, non solo il giocatore. Per capire chi ha guadagnato e chi
  // ha perso serve un termine di paragone dentro lo stesso calcolo, e usiamo il
  // top che gioca regolarmente.
  const ratioBefore = star.b.baseValue / steady.b.baseValue;
  const ratioAfter = star.a.baseValue / steady.a.baseValue;
  assert(
    "e perde terreno rispetto a un pari livello che gioca",
    ratioAfter < ratioBefore,
    [ratioBefore.toFixed(2), ratioAfter.toFixed(2)],
  );

  // -------------------------------------------------------------------------
  // Il consiglio scritto, non solo il numero.
  //
  // Il motore la stagione in corso la pesava gia' bene, ma il testo dei pro e
  // contro leggeva la riga piu' recente come "la scorsa stagione". A campionato
  // iniziato quella riga ha due giornate, e su un attaccante da 33 crediti
  // reduce da 30 presenze e 17 gol diceva "Solo 2 presenze la scorsa stagione",
  // "l'anno scorso ha giocato poco (2)" e "in calo: fantamedia scesa di 2.65".
  // Tre affermazioni false, e insieme gli toglieva il "titolare in tutte le
  // ultime stagioni" che meritava. Peggiorava con la qualita' del giocatore.
  // -------------------------------------------------------------------------
  const stateDopo = buildMarketState({
    league,
    participants,
    events: [],
    players: new Map(after.map((p) => [p.id, p])),
    valuations: valsAfter.byPlayer,
    myParticipantId: "t0",
  });
  const steadyPlayer = after.find((p) => p.id === steadyId)!;
  const rec = recommend({
    player: steadyPlayer,
    state: stateDopo,
    valuations: valsAfter,
    allPlayers: after,
    strategyKey: "equilibrata",
  });
  const testo = [...rec.pros, ...rec.cons, ...rec.notes].join(" | ");
  const concluse = steadyPlayer.history.filter((h) => h.season !== "2026-27" && h.matches > 0);
  const presenzeConcluse = new Set(concluse.map((h) => h.matches));

  assert(
    "le due giornate in corso non vengono chiamate 'la scorsa stagione'",
    !/(?:Solo 2|Solo 1|Solo 0) presenze la scorsa stagione/.test(testo),
    testo,
  );
  assert(
    "ne 'l'anno scorso ha giocato poco'",
    !/anno scorso ha giocato poco \((?:0|1|2)\)/.test(testo),
    testo,
  );
  assert(
    "un titolare storico non risulta 'in calo' per due giornate",
    !/In calo/.test(testo),
    testo,
  );
  // E il controllo che vale per qualunque frase: se il testo cita un numero di
  // presenze attribuendolo all'anno scorso, quel numero deve appartenere a una
  // stagione davvero conclusa. E' piu' generale di cercare una frase precisa —
  // le frasi cambiano, la regola no.
  const citate = [...testo.matchAll(/l'anno scorso in (\d+) presenze/g)].map((m) => Number(m[1]));
  assert(
    "i numeri attribuiti all'anno scorso vengono da una stagione conclusa",
    citate.every((n) => presenzeConcluse.has(n)),
    { citate, concluse: [...presenzeConcluse] },
  );

  // -------------------------------------------------------------------------
  // Un giocatore non e' un sostituto di se stesso.
  //
  // Aprendo Lautaro Martinez la scheda rispondeva che se lo perdi ti resta
  // Lautaro Martinez. Il danno non era solo la frase: quel conteggio e' anche
  // l'offerta con cui si misura la scarsita', quindi ognuno si faceva da
  // sostituto e si abbassava il prezzo da solo.
  // -------------------------------------------------------------------------
  assert(
    "chi stai valutando non compare fra le sue alternative",
    !rec.alternatives.some((a) => a.id === steadyPlayer.id),
    rec.alternatives.map((a) => a.name),
  );
  assert(
    "e le alternative sono tutte del suo ruolo",
    rec.alternatives.every((a) => after.find((p) => p.id === a.id)?.role === steadyPlayer.role),
  );

  const hotRatioBefore = hot.b.expApps / steady.b.expApps;
  const hotRatioAfter = hot.a.expApps / steady.a.expApps;
  assert(
    "chi parte titolare guadagna terreno sulle presenze",
    hotRatioAfter >= hotRatioBefore,
    [hotRatioBefore.toFixed(2), hotRatioAfter.toFixed(2)],
  );
  return bad;
}

const currentSeasonFailures = currentSeasonScenario();
console.log(
  currentSeasonFailures === 0
    ? "\nScenario campionato in corso: tutto coerente\n"
    : `\nScenario campionato in corso: ${currentSeasonFailures} problemi\n`,
);

/**
 * Il tetto si muove con l'asta.
 *
 * Non e' piu' una percentuale del prezzo giusto: e' il prezzo del ripiego piu'
 * quanto lui vale in piu' del ripiego. Quindi con i ricambi liberi resta basso,
 * e quando sono finiti sale — che e' il momento in cui un tetto rigido fa
 * perdere l'asta.
 */
function tettoScenario() {
  console.log("\n=== Il tetto segue i ricambi, non una percentuale ===");
  const pool = makePool();
  const budget = 500;
  const n = 8;
  const vals = buildValuations(pool, {
    season: "2026-27", nParticipants: n, budget, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
    topPrices: { prices: [280, 240], budget: 500 },
  });
  const perId = new Map(pool.map((p) => [p.id, p]));
  const bersaglio = perId.get(vals.byRole.A[0].playerId)!;

  const consiglio = (presi: string[]) => {
    const events = presi.map((pid, i) => ({
      id: `e${i}`, league_id: "L", player_id: pid, participant_id: `t${(i % (n - 1)) + 1}`,
      price: Math.round((vals.byPlayer.get(pid)?.baseValue ?? 10) * 1.2),
      outcome: "assigned" as const, created_at: new Date().toISOString(),
    }));
    const st = buildMarketState({
      league, participants, events,
      players: new Map(pool.map((p) => [p.id, p])),
      valuations: vals.byPlayer, myParticipantId: "t0",
    });
    return recommend({
      player: bersaglio, state: st, valuations: vals, allPlayers: pool, strategyKey: "attacco_forte",
    });
  };

  const inizio = consiglio([]);
  const dopo = consiglio(vals.byRole.A.slice(1, 9).map((v) => v.playerId));

  let bad = 0;
  const assert = (label: string, ok: boolean, detail?: unknown) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`, ok ? "" : (detail ?? ""));
    if (!ok) bad++;
  };
  console.log(
    `  quanto lo vuoi: ${inizio.breakdown.substitutionCap} con i ricambi liberi -> ` +
      `${dopo.breakdown.substitutionCap} quando sono finiti`,
  );
  console.log(
    `  quanto serve:   ${inizio.max} -> ${dopo.max}  (tetto di chi lo vuole ` +
      `${inizio.breakdown.wantedCeiling} -> ${dopo.breakdown.wantedCeiling})`,
  );
  // Due cose diverse, e per un po' il controllo le ha confuse.
  //
  // Chiedeva che il **tetto d'offerta** salisse del 30% quando i ricambi
  // finiscono, e trovava +3%: sembrava una regressione e non lo era. Quello che
  // sale e' quanto lo vuoi — il prezzo giusto piu' il premio sul ripiego, che
  // senza ripiego e' tutto il giocatore. Il tetto vero e' un'altra cosa: **fin
  // dove serve arrivare**, cioe' un credito sopra chi lo vuole. E le stesse
  // otto chiamate che tolgono i ricambi svuotano anche le tasche di chi
  // rilancia, quindi quel numero scende mentre l'altro sale.
  //
  // Confonderli costa in due modi opposti: misurare il primo sul secondo fa
  // gridare al bug quando non c'e', e alzare il secondo per farlo somigliare al
  // primo vuol dire pagare crediti che nessuno ti stava chiedendo.
  //
  // Il tetto di chi lo vuole, misurato, quasi non si muove (185 -> 191): i
  // rivali hanno meno crediti ma hanno appena dimostrato di pagare sopra
  // valore, e le due cose si annullano. Quindi la prova non e' che scenda: e'
  // che la **forbice si apra** — quanto lo vuoi raddoppia, quanto serve resta
  // dov'e'.
  assert(
    "quanto lo vuoi sale quando i ricambi finiscono",
    dopo.breakdown.substitutionCap > inizio.breakdown.substitutionCap * 1.3,
    [inizio.breakdown.substitutionCap, dopo.breakdown.substitutionCap],
  );
  assert(
    "e senza ricambi vale piu' del suo prezzo giusto",
    dopo.breakdown.substitutionCap > dopo.fair,
    [dopo.breakdown.substitutionCap, dopo.fair],
  );
  assert(
    "ma non si offre mai piu' di un credito sopra chi lo vuole",
    dopo.max <= dopo.breakdown.wantedCeiling + 1,
    [dopo.max, dopo.breakdown.wantedCeiling],
  );
  const forbiceInizio = inizio.breakdown.substitutionCap - inizio.max;
  const forbiceDopo = dopo.breakdown.substitutionCap - dopo.max;
  assert(
    "e la forbice fra quanto lo vuoi e quanto serve si apre",
    forbiceDopo > forbiceInizio * 3,
    [forbiceInizio, forbiceDopo],
  );
  assert("e supera il valore base del giocatore", dopo.max > vals.byRole.A[0].baseValue, [
    dopo.max, Math.round(vals.byRole.A[0].baseValue),
  ]);
  assert("all'inizio invece resta prudente", inizio.max <= inizio.fair);
  assert(
    "senza ricambi il verdetto lo dichiara",
    dopo.alternatives.length > 0 || dopo.verdict === "ULTIMO_DELLA_FASCIA",
    dopo.verdict,
  );
  assert(
    "e il ripiego viene detto con nome e prezzo",
    inizio.alternatives.length === 0 || inizio.alternatives[0].fair > 0,
    inizio.alternatives[0],
  );
  /**
   * Il tetto di un avversario e' del **giocatore**, non del suo portafogli.
   *
   * Il conto era rovesciato — si prendeva il massimo fra il budget del reparto
   * e il valore del giocatore — e diceva che un avversario poteva arrivare a
   * 97 su un riempitivo da un credito. Non e' ottimismo: e' il numero che
   * decide fin dove ti conviene alzare il prezzo, e su un giocatore che nessuno
   * vuole la risposta giusta e' "non puoi fargliela pagare".
   */
  const ultimo = vals.byRole.A[vals.byRole.A.length - 1];
  const riempitivo = perId.get(ultimo.playerId)!;
  const stIniziale = buildMarketState({
    league, participants, events: [],
    players: new Map(pool.map((p) => [p.id, p])),
    valuations: vals.byPlayer, myParticipantId: "t0",
  });
  const suRiempitivo = recommend({
    player: riempitivo, state: stIniziale, valuations: vals, allPlayers: pool,
    strategyKey: "attacco_forte",
  });
  const tettoRiempitivo = suRiempitivo.rilancio?.tettoRivale ?? 0;
  const tettoTop = inizio.breakdown.wantedCeiling;
  console.log(
    `  tetto degli avversari: ${Math.round(tettoTop)} sul top da ` +
      `${Math.round(vals.byRole.A[0].baseValue)}, ${tettoRiempitivo} sul riempitivo da ` +
      `${Math.round(ultimo.baseValue)}`,
  );
  assert(
    "nessuno spende il budget del reparto su un riempitivo",
    tettoRiempitivo <= Math.max(5, ultimo.baseValue * 4),
    [tettoRiempitivo, Math.round(ultimo.baseValue)],
  );
  assert(
    "mentre sul top ci arriva eccome",
    tettoTop > vals.byRole.A[0].baseValue,
    [tettoTop, Math.round(vals.byRole.A[0].baseValue)],
  );

  /**
   * E il tetto e' personalizzato su **quello che ognuno ha gia' comprato**.
   *
   * E' l'unica cosa che di un avversario si sa davvero: la sua strategia non la
   * conosce nessuno, e leggerla sarebbe barare. Ma non serve — chi ha il
   * reparto vuoto si scalda su quel reparto, chi l'ha gia' riempito no. Qui i
   * rivali comprano tre attaccanti da pochi crediti l'uno: la cassa resta quasi
   * quella, cambia solo il bisogno.
   */
  // Tutti i rivali, non tre: il tetto mostrato e' il piu' alto di tutti, e
  // basta un avversario col reparto vuoto perche' non cambi niente.
  const quantiRivali = participants.length - 1;
  const attaccoPieno = vals.byRole.A.slice(-(quantiRivali * 3)).map((v, i) => ({
    id: `f${i}`, league_id: "L", player_id: v.playerId,
    participant_id: `t${(i % quantiRivali) + 1}`,
    price: 2, outcome: "assigned" as const, created_at: new Date().toISOString(),
  }));
  const stPieno = buildMarketState({
    league, participants, events: attaccoPieno,
    players: new Map(pool.map((p) => [p.id, p])),
    valuations: vals.byPlayer, myParticipantId: "t0",
  });
  const conAttaccoPieno = recommend({
    player: bersaglio, state: stPieno, valuations: vals, allPlayers: pool,
    strategyKey: "attacco_forte",
  });
  console.log(
    `  stesso top: tetto ${Math.round(tettoTop)} con gli attacchi vuoti -> ` +
      `${Math.round(conAttaccoPieno.breakdown.wantedCeiling)} dopo che tutti i rivali hanno riempito il reparto`,
  );
  assert(
    "chi ha gia' il reparto pieno offre meno di chi ce l'ha vuoto",
    conAttaccoPieno.breakdown.wantedCeiling < tettoTop * 0.9,
    [tettoTop, conAttaccoPieno.breakdown.wantedCeiling],
  );

  console.log(bad === 0 ? "  Tetto: coerente" : `  Tetto: ${bad} problemi`);
  return bad;
}

const tettoFailures = tettoScenario();
const ancoreFailures = ancoreScenario();
if (currentSeasonFailures + ancoreFailures + tettoFailures > 0) process.exit(1);
