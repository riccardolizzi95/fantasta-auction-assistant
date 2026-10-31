/**
 * Il consiglio dipende davvero da quello che e' successo all'asta?
 *
 * E' la domanda che nessun altro controllo fa. `check:asta` misura se chi segue
 * il software vince, ma un motore potrebbe vincere anche dando sempre lo stesso
 * numero, se quel numero e' buono. Qui si misura una cosa piu' esigente e piu'
 * fragile: che **un solo acquisto registrato faccia divergere i consigli**, e
 * che due giocatori diversi non ricevano mai la stessa identica risposta.
 *
 * Se un consiglio non si muove quando il mondo intorno cambia, non e' un
 * consiglio: e' una tabella.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:contesto
 */
import { buildValuations } from "../src/lib/fanta/valuation";
import { buildMarketState } from "../src/lib/fanta/market";
import { recommend, type Recommendation } from "../src/lib/fanta/recommend";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLES,
  type AuctionEventRow,
  type PlayerWithStats,
  type Role,
} from "../src/lib/fanta/types";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BUDGET = 500;
const N = 8;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`, ok ? "" : (detail ?? ""));
  if (!ok) failures++;
}

async function login() {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const s = await r.json();
  if (!r.ok) throw new Error(`login: ${JSON.stringify(s)}`);
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

/** L'impronta di un consiglio: se due sono uguali qui, sono uguali per chi legge. */
const impronta = (r: Recommendation) =>
  [
    r.fair,
    r.target,
    r.max,
    r.walkAway,
    r.verdict,
    Math.round(r.priority),
    r.alternatives.map((a) => `${a.id}:${a.fair}`).join("|"),
    r.tettoAvversari?.valore ?? "-",
    r.rilancio?.finoA ?? "-",
    r.pros.join("·"),
    r.cons.join("·"),
    r.notes.join("·"),
  ].join(" / ");

async function main() {
  const players = await carica(await login());
  const league = {
    id: "L", name: "Contesto", season: players[0]?.season ?? "2026-27", mode: "classic" as const,
    owner_id: "u", budget: BUDGET, n_participants: N, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
    auction_format: "chiamata" as const, status: "auction" as const, invite_code: "X",
    top_prices: { prices: [280, 240], budget: 500 },
  };
  const vals = buildValuations(players, {
    season: league.season, nParticipants: N, budget: BUDGET,
    slots: DEFAULT_SLOTS, rules: DEFAULT_RULES, topPrices: league.top_prices,
  });
  const partecipanti = Array.from({ length: N }, (_, i) => ({
    id: `t${i}`, league_id: "L", user_id: i === 0 ? "u" : null,
    name: i === 0 ? "Io" : `Rivale ${i}`, display_name: null, budget_total: BUDGET,
  })) as never[];
  const perId = new Map(players.map((p) => [p.id, p]));

  const stato = (eventi: AuctionEventRow[]) =>
    buildMarketState({
      league, participants: partecipanti, events: eventi,
      players: perId, valuations: vals.byPlayer, myParticipantId: "t0",
    });

  const consiglia = (p: PlayerWithStats, eventi: AuctionEventRow[]) =>
    recommend({
      player: p, state: stato(eventi), valuations: vals, allPlayers: players,
      strategyKey: "equilibrata",
    });

  const evento = (playerId: string, chi: string | null, prezzo: number, i: number): AuctionEventRow =>
    ({
      id: `e${i}`, league_id: "L", player_id: playerId, participant_id: chi,
      price: prezzo, outcome: chi ? "assigned" : "unsold", created_at: new Date().toISOString(),
    }) as AuctionEventRow;

  // Un campione che copre ruoli e fasce: i primi tre e un paio di mezzi per ruolo.
  const perRuolo = (r: Role) =>
    players
      .filter((p) => p.role === r)
      .sort((a, b) => (vals.byPlayer.get(b.id)?.baseValue ?? 0) - (vals.byPlayer.get(a.id)?.baseValue ?? 0));
  const campione = ROLES.flatMap((r) => {
    const l = perRuolo(r);
    return [l[0], l[1], l[2], l[Math.floor(l.length / 3)], l[Math.floor(l.length / 2)]].filter(Boolean);
  });

  console.log(`\n${players.length} giocatori, campione di ${campione.length} fra tutte le fasce.\n`);

  // ---------------------------------------------------------------- 1
  console.log("== 1. Due giocatori diversi ricevono consigli diversi ==");
  const base = new Map(campione.map((p) => [p.id, consiglia(p, [])]));
  const improntе = new Map<string, string[]>();
  for (const p of campione) {
    const k = impronta(base.get(p.id)!);
    improntе.set(k, [...(improntе.get(k) ?? []), p.name]);
  }
  const collisioni = [...improntе.values()].filter((v) => v.length > 1);
  check(
    "nessuna coppia riceve la stessa identica risposta",
    collisioni.length === 0,
    collisioni.slice(0, 3),
  );

  // ---------------------------------------------------------------- 2
  console.log("\n== 2. Un solo acquisto sposta i consigli ==");
  const topA = perRuolo("A")[0];
  const topD = perRuolo("D")[0];
  const gregario = perRuolo("C")[Math.floor(perRuolo("C").length / 2)];

  const scenari: { nome: string; eventi: AuctionEventRow[] }[] = [
    { nome: "un rivale prende il primo attaccante a 250", eventi: [evento(topA.id, "t1", 250, 0)] },
    { nome: "lo prendo io a 250", eventi: [evento(topA.id, "t0", 250, 0)] },
    { nome: "un rivale prende il primo difensore a 200", eventi: [evento(topD.id, "t1", 200, 0)] },
    { nome: "un rivale prende un gregario a 5", eventi: [evento(gregario.id, "t1", 5, 0)] },
    {
      nome: "un rivale ha speso quasi tutto (5 acquisti)",
      eventi: perRuolo("A").slice(1, 6).map((p, i) => evento(p.id, "t1", 90, i)),
    },
  ];

  for (const sc of scenari) {
    let mossi = 0;
    let sommaMax = 0;
    let maxMax = 0;
    let quale = "";
    let considerati = 0;
    for (const p of campione) {
      // Chi e' stato comprato esce dal listone: non e' un consiglio spostato.
      if (sc.eventi.some((e) => e.player_id === p.id)) continue;
      considerati++;
      const prima = base.get(p.id)!;
      const dopo = consiglia(p, sc.eventi);
      if (impronta(prima) !== impronta(dopo)) mossi++;
      const d = Math.abs(dopo.max - prima.max);
      sommaMax += d;
      if (d > maxMax) {
        maxMax = d;
        quale = `${p.name} ${prima.max}->${dopo.max}`;
      }
    }
    console.log(
      `  ${sc.nome.padEnd(46)} ${((100 * mossi) / considerati).toFixed(0).padStart(3)}% dei consigli cambia, ` +
        `tetto medio ${(sommaMax / considerati).toFixed(1).padStart(5)} crediti (max ${maxMax}: ${quale})`,
    );
    check(`    ${sc.nome}: qualcosa si muove`, mossi > 0);
  }

  // ---------------------------------------------------------------- 3
  console.log("\n== 3. Lo stesso giocatore, due aste diverse ==");
  // Due mondi opposti: in uno la sua fascia e' stata svuotata, nell'altro i
  // rivali hanno finito i soldi. Il consiglio deve andare in direzioni opposte.
  const lui = perRuolo("A")[3];
  const fasciaVuota = perRuolo("A")
    .filter((p) => p.id !== lui.id)
    .slice(0, 6)
    .map((p, i) => evento(p.id, `t${(i % 6) + 1}`, 120, i));
  // Al verde davvero: tre acquisti da 150 a testa lasciano a ognuno una
  // cinquantina di crediti per una ventina di slot, cioe' niente.
  const rivaliAlVerde = ROLES.flatMap((r) => perRuolo(r).filter((p) => p.id !== lui.id).slice(0, 6))
    .slice(0, 21)
    .map((p, i) => evento(p.id, `t${(i % 7) + 1}`, 150, i));

  const cSolo = consiglia(lui, []);
  const cVuota = consiglia(lui, fasciaVuota);
  const cVerde = consiglia(lui, rivaliAlVerde);
  console.log(`  ${lui.name} (${lui.team}), asta appena aperta:      giusto ${cSolo.fair}, tetto ${cSolo.max}, ${cSolo.verdict}`);
  console.log(`  ... dopo che la sua fascia si e' svuotata:  giusto ${cVuota.fair}, tetto ${cVuota.max}, ${cVuota.verdict}`);
  console.log(`  ... con i rivali quasi senza crediti:       giusto ${cVerde.fair}, tetto ${cVerde.max}, ${cVerde.verdict}`);
  check("svuotare la fascia alza il tetto", cVuota.max > cSolo.max, [cSolo.max, cVuota.max]);
  // Quando nessuno puo' piu' permetterselo il tetto di chi lo vuole non esiste
  // proprio: non c'e' piu' nessuno che lo vuole. Quello che deve scendere e'
  // quanto serve offrire.
  check(
    "rivali senza crediti abbassano quello che serve offrire",
    cVerde.max < cSolo.max && (cVerde.tettoAvversari?.valore ?? 0) < (cSolo.tettoAvversari?.valore ?? 0),
    [cSolo.max, cVerde.max, cSolo.tettoAvversari?.valore, cVerde.tettoAvversari?.valore],
  );
  check("i tre consigli sono tre cose diverse", new Set([impronta(cSolo), impronta(cVuota), impronta(cVerde)]).size === 3);

  // ---------------------------------------------------------------- 4
  console.log("\n== 4. Se comprano uno come lui, il consiglio cambia? ==");
  // E' la prova piu' esigente, ed e' quella che conta: non "e' successo
  // qualcosa da qualche parte", ma **hanno comprato un suo sostituto**. Se il
  // consiglio non si muove qui, il contesto non lo sta guidando.
  let mossiFascia = 0;
  let sommaFascia = 0;
  const dettagli: string[] = [];
  for (const p of campione) {
    const vicini = perRuolo(p.role as Role)
      .filter((x) => x.id !== p.id)
      .map((x) => ({ x, d: Math.abs((vals.byPlayer.get(x.id)?.baseValue ?? 0) - (vals.byPlayer.get(p.id)?.baseValue ?? 0)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((v, k) => evento(v.x.id, `t${k + 1}`, Math.round(vals.byPlayer.get(v.x.id)?.baseValue ?? 10), k));
    const a = base.get(p.id)!;
    const b = consiglia(p, vicini);
    if (impronta(a) !== impronta(b)) mossiFascia++;
    sommaFascia += Math.abs(b.max - a.max);
    if (dettagli.length < 4 && b.max !== a.max) {
      dettagli.push(`${p.name}: tetto ${a.max} -> ${b.max}, giusto ${a.fair} -> ${b.fair}`);
    }
  }
  console.log(
    `  tolti i tre sostituti piu' vicini: ${mossiFascia}/${campione.length} consigli cambiano, ` +
      `tetto di ${(sommaFascia / campione.length).toFixed(1)} crediti in media`,
  );
  for (const d of dettagli) console.log(`    ${d}`);
  check(
    "comprare i suoi sostituti cambia il consiglio su di lui",
    mossiFascia >= campione.length * 0.9,
    `${mossiFascia}/${campione.length}`,
  );

  console.log("\n== 5. Quale pezzo di contesto sta lavorando ==");
  // Un ingrediente che resta fermo non e' un ingrediente: e' una costante con
  // un nome lungo. Qui si guardano prima e dopo gli stessi sei acquisti.
  const dopoQualcosa = [
    evento(topA.id, "t1", 250, 0),
    evento(topD.id, "t2", 180, 1),
    ...perRuolo("C").slice(0, 4).map((p, i) => evento(p.id, `t${i + 3}`, 100, i + 2)),
  ];
  const validi = campione.filter((p) => !dopoQualcosa.some((e) => e.player_id === p.id));
  const prima = validi.map((p) => base.get(p.id)!);
  const dopo = validi.map((p) => consiglia(p, dopoQualcosa));

  const pezzi: { nome: string; leggi: (r: Recommendation) => number }[] = [
    { nome: "inflazione", leggi: (r) => r.breakdown.inflation },
    { nome: "scarsita'", leggi: (r) => r.breakdown.scarcityFactor },
    { nome: "domanda (chi lo vuole ancora)", leggi: (r) => r.breakdown.demand },
    { nome: "offerta (quanti ne restano)", leggi: (r) => r.breakdown.supply },
    { nome: "il mio piano di spesa", leggi: (r) => r.breakdown.planCap },
    { nome: "tetto di chi lo vuole", leggi: (r) => r.tettoAvversari?.valore ?? 0 },
    { nome: "premio sul ripiego", leggi: (r) => r.premioSulRipiego ?? 0 },
    { nome: "-> prezzo giusto", leggi: (r) => r.fair },
    { nome: "-> tetto d'offerta", leggi: (r) => r.max },
  ];
  console.log("  ingrediente                    quanti si muovono   di quanto (media)");
  for (const pz of pezzi) {
    const d = prima.map((a, k) => Math.abs(pz.leggi(dopo[k]) - pz.leggi(a)));
    const mossi = d.filter((x) => x > 1e-9).length;
    console.log(
      `  ${pz.nome.padEnd(30)} ${`${mossi}/${d.length}`.padStart(12)}   ` +
        `${(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2).padStart(12)}`,
    );
  }

  // ---------------------------------------------------------------- 6
  console.log("\n== 6. Il finale d'asta: 302 crediti, due slot, un top da 300 ==");
  // La domanda che il solo tetto d'offerta non fa. Prenderlo e riempire a un
  // credito e' un errore o no? Dipende da cosa vale un credito in quel momento,
  // e quello dipende dalle tasche degli altri — non dai giocatori rimasti.
  const attaccanti = perRuolo("A");
  const ilTop = attaccanti[0];

  /** Mi compro quasi tutta la rosa, lasciando due slot e 302 crediti. */
  const quasiPieno = (rivaliAlVerde: boolean): AuctionEventRow[] => {
    const eventi: AuctionEventRow[] = [];
    let i = 0;
    let spesi = 0;
    // 23 giocatori miei, a poco, per lasciare 302 crediti e due slot.
    const miei: PlayerWithStats[] = [];
    for (const r of ROLES) {
      const quanti = DEFAULT_SLOTS[r] - (r === "A" ? 2 : 0);
      for (const p of perRuolo(r).filter((x) => x.id !== ilTop.id).slice(0, quanti)) miei.push(p);
    }
    for (const p of miei) {
      const prezzo = Math.max(1, Math.round((BUDGET - 302) / miei.length));
      spesi += prezzo;
      eventi.push(evento(p.id, "t0", prezzo, i++));
    }
    // Gli avversari: o hanno ancora tutto, o hanno bruciato quasi tutto.
    if (rivaliAlVerde) {
      for (let t = 1; t < N; t++) {
        const preda = attaccanti.filter((x) => x.id !== ilTop.id && !miei.includes(x)).slice(t * 2, t * 2 + 3);
        for (const p of preda) eventi.push(evento(p.id, `t${t}`, 150, i++));
      }
    }
    void spesi;
    return eventi;
  };

  for (const [nome, rivaliAlVerde] of [
    ["gli avversari hanno ancora i soldi", false],
    ["gli avversari sono a secco", true],
  ] as const) {
    const eventi = quasiPieno(rivaliAlVerde);
    const st = stato(eventi);
    const rec = consiglia(ilTop, eventi);
    const io = st.me!;
    console.log(
      `\n  ${nome}: ho ${io.remaining} crediti e ${io.totalSlotsLeft} slot, ` +
        `gli altri in media ${Math.round(st.teams.filter((t) => !t.isMe).reduce((a, t) => a + t.remaining, 0) / (N - 1))}.`,
    );
    if (!rec.piano) {
      console.log("    (nessun piano: non sono un partecipante)");
      continue;
    }
    console.log(
      `    ${ilTop.name}: giusto ${rec.fair}, tetto ${rec.max}, ` +
        `pareggio ${rec.piano.pareggio} — oltre quella cifra conviene il piano B.`,
    );
    console.log(
      `    con lui ${rec.piano.conLui} punti a giornata, senza ${rec.piano.senzaDiLui}. ` +
        `Il migliore a un credito rende ${rec.piano.valoreDiUnCredito}.`,
    );
    if (rec.piano.poi.length > 0) {
      console.log(
        `    col resto prenderesti: ${rec.piano.poi.map((x) => `${x.name} a ${x.prezzo} (${Math.round(x.probabilita * 100)}%)`).join(", ")}`,
      );
    }
  }
  check(
    "il pareggio esiste ed e' un numero sensato",
    (() => {
      const r = consiglia(ilTop, quasiPieno(true));
      return !!r.piano && r.piano.pareggio >= 1 && r.piano.pareggio <= 302;
    })(),
  );

  console.log(failures === 0 ? "\nIL CONTESTO COMANDA\n" : `\n${failures} PROBLEMI\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
