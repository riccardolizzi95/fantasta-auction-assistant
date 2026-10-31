/**
 * La curva dei prezzi: quanto il modello concentra sui migliori.
 *
 * Serve perche' un modello puo' avere l'ordine giusto e la **forma** sbagliata.
 * Se all'asta vera il piu' caro va a 240 su un budget di 500 e il modello ne
 * consiglia 70, l'ordine dei giocatori non conta piu': si perdono tutti i top
 * per non aver alzato la mano, e restano crediti in tasca a fine asta.
 *
 * Il modello tara la concentrazione sul **listino** (il Fantavalore), che e' un
 * prezziario e non il verbale di un'asta. Questo script mette le due curve una
 * accanto all'altra e le confronta con i prezzi veri, quando ce ne sono.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:prices
 */
import { buildValuations } from "../src/lib/fanta/valuation";
import { buildMarketState } from "../src/lib/fanta/market";
import { recommend, VERDICT_LABEL } from "../src/lib/fanta/recommend";
import { DEFAULT_RULES, DEFAULT_SLOTS, ROLES, type PlayerWithStats, type Role } from "../src/lib/fanta/types";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Prezzi d'asta veri, per confronto. Sono quelli che l'utente ricorda della
 * scorsa stagione: due punti soli, ma sono l'unico dato che dice come si
 * comporta la sua lega invece di come si comporta un prezziario.
 */
const ASTE_VERE: { nome: string; prezzo: number; budget: number }[] = [
  { nome: "David", prezzo: 280, budget: 500 },
  { nome: "Lautaro", prezzo: 240, budget: 500 },
];

async function login() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const s = await auth.json();
  if (!auth.ok) throw new Error(`login: ${JSON.stringify(s)}`);
  return s.access_token as string;
}

async function carica(token: string): Promise<PlayerWithStats[]> {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}` };
  const out: PlayerWithStats[] = [];
  for (let da = 0; ; da += 1000) {
    const res = await fetch(
      `${SUPA}/rest/v1/players?select=id,season,external_id,name,team,role,quotation_initial,` +
        `quotation_current,fvm,is_active,player_stats(season,competition,source,rating,matches,minutes,` +
        `avg_vote,avg_fantavote,goals,assists,own_goals,yellow_cards,red_cards,pen_scored,pen_missed,` +
        `pen_saved,goals_conceded,clean_sheets)&is_active=eq.true`,
      { headers: { ...headers, Range: `${da}-${da + 999}`, "Range-Unit": "items" } },
    );
    const chunk = await res.json();
    if (!Array.isArray(chunk)) throw new Error(JSON.stringify(chunk));
    for (const row of chunk as (PlayerWithStats & { player_stats: PlayerWithStats["history"] })[]) {
      const { player_stats, ...resto } = row;
      const history = (player_stats ?? []).slice().sort((a, b) => (a.season < b.season ? 1 : -1));
      out.push({ ...(resto as PlayerWithStats), history, stats: history[0] ?? null });
    }
    if (chunk.length < 1000) break;
  }
  return out;
}

const soldi = (v: number) => Math.round(v).toString().padStart(4);

async function main() {
  const players = await carica(await login());
  const budget = Number(process.env.BUDGET || 500);
  const n = Number(process.env.PARTECIPANTI || 8);
  const season = players[0]?.season ?? "2026-27";

  const vals = buildValuations(players, {
    season,
    nParticipants: n,
    budget,
    slots: DEFAULT_SLOTS,
    rules: DEFAULT_RULES,
  });

  const perId = new Map(players.map((p) => [p.id, p]));
  const tutti = [...vals.byPlayer.values()].sort((a, b) => b.baseValue - a.baseValue);
  const totale = tutti.reduce((a, v) => a + v.baseValue, 0);
  const montePremi = budget * n;

  console.log(
    `Lega: ${n} partecipanti x ${budget} crediti = ${montePremi} in palio, ` +
      `${players.length} giocatori.\n` +
      `Il modello distribuisce ${Math.round(totale)} crediti.\n`,
  );

  // La stessa curva, dal modello e dal listino: e' il confronto che conta.
  const fvmOrdinati = players
    .map((p) => Number(p.fvm ?? p.quotation_current ?? 0))
    .sort((a, b) => b - a);
  const modelloOrdinati = tutti.map((v) => v.baseValue);
  const quota = (arr: number[], k: number) =>
    (arr.slice(0, k).reduce((a, b) => a + b, 0) / arr.reduce((a, b) => a + b, 0)) * 100;

  console.log("quanto pesano i piu' cari sul totale:");
  console.log("            modello   listino");
  for (const k of [1, 3, 5, 10, 20, 50]) {
    console.log(
      `  primi ${String(k).padStart(2)}   ${quota(modelloOrdinati, k).toFixed(1).padStart(5)}%   ` +
        `${quota(fvmOrdinati, k).toFixed(1).padStart(5)}%`,
    );
  }

  console.log("\ni piu' cari secondo il modello:");
  for (const v of tutti.slice(0, 12)) {
    const p = perId.get(v.playerId)!;
    console.log(
      `  ${soldi(v.baseValue)}  ${p.name.padEnd(18)} ${p.role}  ${p.team.padEnd(12)} ` +
        `listino ${String(p.fvm ?? "—").padStart(4)}  quotazione ${String(p.quotation_current ?? "—").padStart(3)}`,
    );
  }

  console.log("\nil piu' caro di ogni ruolo:");
  for (const r of ROLES) {
    const primo = vals.byRole[r as Role][0];
    if (!primo) continue;
    const p = perId.get(primo.playerId)!;
    console.log(
      `  ${r}  ${soldi(primo.baseValue)}  ${p.name.padEnd(18)} ` +
        `(${((primo.baseValue / budget) * 100).toFixed(0)}% di un budget)`,
    );
  }

  // Fin dove arriva la manopola della concentrazione: 0 e' il massimo che il
  // modello sa fare, 1 il minimo. Se nemmeno 0 raggiunge i prezzi veri, il
  // rimedio non e' girare questa manopola.
  console.log("\nquanto puo' concentrare la manopola (soglia del rimpiazzo):");
  for (const b of [0, 0.15, 0.3, 0.5, 0.75, 1]) {
    const v = buildValuations(players, {
      season, nParticipants: n, budget, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
      benchOverride: b,
    });
    const ord = [...v.byPlayer.values()].sort((a, b2) => b2.baseValue - a.baseValue);
    console.log(
      `  soglia ${b.toFixed(2)}  il piu' caro ${soldi(ord[0].baseValue)}  ` +
        `primi 20 ${((ord.slice(0, 20).reduce((a, x) => a + x.baseValue, 0) /
          ord.reduce((a, x) => a + x.baseValue, 0)) * 100).toFixed(1)}%`,
    );
  }

  if (ASTE_VERE.length > 0) {
    console.log("\ncontro i prezzi d'asta veri della scorsa stagione:");
    const piuCaro = tutti[0].baseValue;
    for (const a of ASTE_VERE) {
      const atteso = (a.prezzo / a.budget) * budget;
      console.log(
        `  ${a.nome.padEnd(10)} pagato ${soldi(a.prezzo)} su ${a.budget} ` +
          `-> qui sarebbero ${soldi(atteso)}; tarato sul listino il modello ` +
          `dice al massimo ${soldi(piuCaro)} (${(piuCaro / atteso).toFixed(2)}x)`,
      );
    }

    // La stessa cosa, ma tarata sui prezzi veri invece che sul listino.
    const conAncore = buildValuations(players, {
      season, nParticipants: n, budget, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
      topPrices: { prices: ASTE_VERE.map((a) => a.prezzo), budget: ASTE_VERE[0].budget },
    });
    const ord = [...conAncore.byPlayer.values()].sort((a, b) => b.baseValue - a.baseValue);
    console.log("\ntarando sui prezzi veri invece che sul listino:");
    for (const v of ord.slice(0, 8)) {
      const p = perId.get(v.playerId)!;
      const prima = vals.byPlayer.get(v.playerId)!.baseValue;
      console.log(
        `  ${soldi(v.baseValue)}  ${p.name.padEnd(18)} ${p.role}  ` +
          `(prima ${soldi(prima)}, ${(v.baseValue / Math.max(1, prima)).toFixed(2)}x)`,
      );
    }
    const totaleDopo = ord.reduce((a, v) => a + v.baseValue, 0);
    console.log("\n  e cosa succede a chi non e' un top:");
    for (const posizione of [30, 60, 100, 150, 220]) {
      const v = ord[posizione - 1];
      if (!v) continue;
      const p = perId.get(v.playerId)!;
      const prima = vals.byPlayer.get(v.playerId)!.baseValue;
      console.log(
        `  n.${String(posizione).padStart(3)}  ${p.name.padEnd(18)} ` +
          `${soldi(prima)} -> ${soldi(v.baseValue)}  (${(v.baseValue / Math.max(1, prima)).toFixed(2)}x)`,
      );
    }
    console.log(`\n  il modello distribuisce ${Math.round(totaleDopo)} crediti su ${montePremi} in palio.`);

    for (const strat of ["equilibrata", "attacco_forte"]) {
      scenarioTetto(players, conAncore, budget, n, strat);
    }
  }
}

/**
 * Come si muove il tetto durante l'asta.
 *
 * Il tetto non e' una percentuale del prezzo giusto: e' il prezzo del ripiego
 * piu' quanto lui vale in piu' del ripiego. Quindi lo stesso giocatore ha un
 * tetto basso quando ce ne sono altri come lui e altissimo quando e' rimasto
 * solo — che e' come si comporta un'asta vera.
 */
function scenarioTetto(
  players: PlayerWithStats[],
  vals: ReturnType<typeof buildValuations>,
  budget: number,
  n: number,
  strategia: string,
) {
  const perId = new Map(players.map((p) => [p.id, p]));
  const league = {
    id: "L", name: "T", season: players[0]?.season ?? "2026-27", mode: "classic" as const,
    owner_id: "u", budget, n_participants: n, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
    auction_format: "chiamata" as const, status: "auction" as const, invite_code: "X",
  };
  const participants = Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, league_id: "L", user_id: i === 0 ? "u" : null,
    name: `T${i}`, display_name: `T${i}`, budget_total: budget,
  })) as never[];

  const attaccanti = vals.byRole.A.slice(0, 3).map((v) => perId.get(v.playerId)!);
  const bersaglio = attaccanti[0];

  // Due momenti: all'inizio, e quando i ricambi della sua fascia sono spariti.
  const scenari: { nome: string; presi: string[] }[] = [
    { nome: "inizio asta, ricambi tutti liberi", presi: [] },
    {
      nome: "gli altri della sua fascia sono andati",
      presi: vals.byRole.A.slice(1, 9).map((v) => v.playerId),
    },
  ];

  console.log(`\nil tetto su ${bersaglio.name}, strategia "${strategia}":`);
  for (const sc of scenari) {
    const events = sc.presi.map((pid, i) => ({
      id: `e${i}`, league_id: "L", player_id: pid, participant_id: `t${(i % (n - 1)) + 1}`,
      price: Math.round((vals.byPlayer.get(pid)?.baseValue ?? 10) * 1.2),
      outcome: "assigned" as const, created_at: new Date().toISOString(),
    }));
    const state = buildMarketState({
      league, participants, events,
      players: new Map(players.map((p) => [p.id, p])),
      valuations: vals.byPlayer, myParticipantId: "t0",
    });
    const rec = recommend({
      player: bersaglio, state, valuations: vals, allPlayers: players, strategyKey: strategia,
    });
    const b = rec.breakdown;
    console.log(
      `  ${sc.nome.padEnd(38)} base ${soldi(b.baseValue)}  giusto ${soldi(rec.fair)}  ` +
        `apri ${soldi(rec.target)}  TETTO ${soldi(rec.max)}  ricambi ${String(rec.alternatives.length).padStart(2)}  ` +
        `${VERDICT_LABEL[rec.verdict]}`,
    );
    console.log(
      `      strategia x${b.strategyMultiplier.toFixed(2)}  inflazione x${b.inflation.toFixed(2)}  ` +
        `scarsita' x${b.scarcityFactor.toFixed(2)}  =  x${(rec.fair / Math.max(1, b.baseValue)).toFixed(2)} ` +
        `sul valore base`,
    );
    if (rec.alternatives[0]) {
      console.log(
        `      ripiego: ${rec.alternatives[0].name} a ${rec.alternatives[0].fair} ` +
          `(${[rec.alternatives[0].somiglia, rec.alternatives[0].differisce].filter(Boolean).join("; ")})`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
