/**
 * Un'asta intera, simulata, con otto persone che rilanciano.
 *
 * Gli altri controlli guardano un consiglio alla volta. Questo guarda la
 * domanda che conta davvero: **chi segue il software finisce con una squadra
 * migliore?** E' l'unica prova che distingue un motore che ha ragione da uno
 * che ha ragione a rate — un tetto troppo basso perde tutti i top, uno troppo
 * alto svuota il budget a meta' asta, e in entrambi i casi i singoli consigli
 * sembravano sensati.
 *
 * Misura tre cose che un consiglio sbagliato rompe in modi diversi:
 * - i punti attesi della formazione titolare, contro chi gioca in altri modi;
 * - se la rosa si riempie (un tetto troppo alto lascia slot vuoti);
 * - quanti crediti restano in mano (un tetto troppo basso li lascia li').
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:asta
 *   GIRI=5 npm run check:asta      # piu' aste, per non credere a un caso
 */
import { buildValuations, type Valuation } from "../src/lib/fanta/valuation";
import { buildMarketState } from "../src/lib/fanta/market";
import { recommend } from "../src/lib/fanta/recommend";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLES,
  STARTERS_PER_TEAM,
  type PlayerWithStats,
  type Role,
  type RoleMap,
} from "../src/lib/fanta/types";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GIRI = Number(process.env.GIRI || 3);
const BUDGET = Number(process.env.BUDGET || 500);
const N = Number(process.env.PARTECIPANTI || 8);

/** Numeri casuali ripetibili: un controllo che cambia a ogni giro non serve. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

/** Come si comporta un avversario. Sono i modi in cui si gioca davvero. */
type Indole = "listino" | "aggressivo" | "prudente" | "software";

const INDOLI: Record<Exclude<Indole, "software">, { moltiplicatore: number; nome: string }> = {
  aggressivo: { moltiplicatore: 1.45, nome: "paga il listino +45%" },
  listino: { moltiplicatore: 1.05, nome: "paga il listino" },
  prudente: { moltiplicatore: 0.8, nome: "paga il listino -20%" },
};

type Squadra = {
  id: string;
  nome: string;
  indole: Indole;
  crediti: number;
  presi: { playerId: string; role: Role; price: number; val: Valuation }[];
};

const slotsLiberi = (s: Squadra, r: Role) =>
  DEFAULT_SLOTS[r] - s.presi.filter((p) => p.role === r).length;
const slotsTotaliLiberi = (s: Squadra) =>
  ROLES.reduce((a, r) => a + Math.max(0, slotsLiberi(s, r)), 0);
/** Quanto puo' offrire restando in grado di completare la rosa a un credito. */
const massimoPossibile = (s: Squadra) => s.crediti - Math.max(0, slotsTotaliLiberi(s) - 1);

/**
 * Se e quanto la squadra che segue il software alza il prezzo agli avversari.
 *
 * "mai" e' il comportamento di prima. "al buio" usa solo la stima di chi
 * potrebbe volerlo. "con la voce" sa chi lo sta rilanciando davvero, che e'
 * esattamente cio' che aggiunge il riconoscimento delle voci: serve per capire
 * se quel riconoscimento vale la fatica o e' un giocattolo.
 */
type ModoRilancio = "mai" | "al buio" | "con la voce";

function simula(
  players: PlayerWithStats[],
  vals: ReturnType<typeof buildValuations>,
  seed: number,
  rilanci: ModoRilancio = "mai",
): {
  squadre: Squadra[];
  eventi: { player_id: string; price: number }[];
  perId: Map<string, PlayerWithStats>;
  /** Quante volte il consiglio sul rilancio e' scattato, e quanto ha spostato. */
  spia: { volte: number; alzata: number; mai: number; risparmiate: number };
} {
  const rand = rng(seed);
  const spia = { volte: 0, alzata: 0, mai: 0, risparmiate: 0 };
  const squadre: Squadra[] = [
    { id: "t0", nome: "SEGUE IL SOFTWARE", indole: "software", crediti: BUDGET, presi: [] },
    ...Array.from({ length: N - 1 }, (_, i) => {
      const indole: Indole = i % 3 === 0 ? "aggressivo" : i % 3 === 1 ? "listino" : "prudente";
      return { id: `t${i + 1}`, nome: `${INDOLI[indole].nome} ${i + 1}`, indole, crediti: BUDGET, presi: [] };
    }),
  ];

  const league = {
    id: "L", name: "Sim", season: players[0]?.season ?? "2026-27", mode: "classic" as const,
    owner_id: "u", budget: BUDGET, n_participants: N, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
    auction_format: "chiamata" as const, status: "auction" as const, invite_code: "X",
    top_prices: { prices: [280, 240], budget: 500 },
  };
  const partecipanti = squadre.map((s) => ({
    id: s.id, league_id: "L", user_id: s.id === "t0" ? "u" : null,
    name: s.nome, display_name: s.nome, budget_total: BUDGET,
  })) as never[];
  const perId = new Map(players.map((p) => [p.id, p]));

  // I giocatori si chiamano dal piu' caro: e' come vanno le aste vere, ed e'
  // anche il caso peggiore per chi deve decidere quando fermarsi.
  const ordine = [...vals.byPlayer.values()]
    .sort((a, b) => b.baseValue - a.baseValue + (rand() - 0.5) * 4)
    .map((v) => v.playerId);

  const eventi: {
    id: string; league_id: string; player_id: string; participant_id: string | null;
    price: number; outcome: "assigned" | "unsold"; created_at: string;
  }[] = [];

  for (const playerId of ordine) {
    const p = perId.get(playerId)!;
    const val = vals.byPlayer.get(playerId)!;
    const role = p.role as Role;
    if (squadre.every((s) => slotsLiberi(s, role) <= 0)) continue;

    const stato = buildMarketState({
      league, participants: partecipanti, events: eventi,
      players: perId, valuations: vals.byPlayer, myParticipantId: "t0",
    });

    // Prima gli avversari: quello che offrono e' anche cio' che il microfono
    // sentirebbe, e va saputo prima di decidere quanto alzare.
    const offerteAltri = squadre
      .filter((s): s is Squadra & { indole: Exclude<Indole, "software"> } => s.indole !== "software")
      .map((s) => {
        if (slotsLiberi(s, role) <= 0) return { s, max: 0 };
        const tetto = massimoPossibile(s);
        if (tetto < 1) return { s, max: 0 };
        const base = val.marketPrice > 0 ? val.marketPrice : val.baseValue;
        const rumore = 0.85 + rand() * 0.3;
        return { s, max: Math.min(Math.round(base * INDOLI[s.indole].moltiplicatore * rumore), tetto) };
      });

    const offerte = squadre.map((s) => {
      if (s.indole !== "software") return offerteAltri.find((o) => o.s === s)!;
      if (slotsLiberi(s, role) <= 0) return { s, max: 0 };
      const tetto = massimoPossibile(s);
      if (tetto < 1) return { s, max: 0 };
      // Chi si sente rilanciare: chi ha davvero intenzione di prenderlo. Con
      // "al buio" non lo sappiamo e il motore se lo stima da solo.
      const inGara =
        rilanci === "con la voce"
          ? offerteAltri.filter((o) => o.max >= val.baseValue * 0.8).map((o) => o.s.id)
          : [];
      const rec = recommend({
        player: p, state: stato, valuations: vals, allPlayers: players,
        strategyKey: "equilibrata", inGara,
      });
      let max = Math.min(rec.max, tetto);
      // Sapere chi rilancia serve soprattutto a **fermarsi**: un credito sopra
      // il tetto del migliore fra loro e' gia' abbastanza per prenderlo.
      if (rilanci === "con la voce" && rec.tettoAvversari?.dallaVoce) {
        const basta = rec.tettoAvversari.valore + 1;
        if (basta < max) {
          spia.risparmiate += max - basta;
          max = basta;
        }
      }
      if (rilanci !== "mai" && rec.rilancio) {
        const alzato = Math.min(rec.rilancio.finoA, tetto);
        if (alzato > max) {
          spia.volte++;
          spia.alzata += alzato - max;
        }
        max = Math.max(max, alzato);
      } else if (rilanci !== "mai") {
        spia.mai++;
      }
      return { s, max };
    });

    const ordinate = offerte.filter((o) => o.max >= 1).sort((a, b) => b.max - a.max);
    if (ordinate.length === 0) continue;
    const vincitore = ordinate[0];
    // Asta all'inglese: si paga uno sopra il secondo, mai piu' del proprio tetto.
    const prezzo = Math.max(1, Math.min(vincitore.max, (ordinate[1]?.max ?? 0) + 1));

    vincitore.s.crediti -= prezzo;
    vincitore.s.presi.push({ playerId, role, price: prezzo, val });
    eventi.push({
      id: `e${eventi.length}`, league_id: "L", player_id: playerId,
      participant_id: vincitore.s.id, price: prezzo, outcome: "assigned",
      created_at: new Date().toISOString(),
    });
  }
  return { squadre, eventi, perId, spia };
}

/**
 * I punti a giornata della formazione titolare.
 *
 * Si usa `effFM`, che porta dentro il modificatore come bonus per giocatore.
 * Provato a calcolarlo invece sulla media della linea schierata, che e' la
 * forma vera della regola: **non si puo', non qui**. Lo zaino che calcola il
 * meglio comprabile a quei prezzi e' separabile per giocatore, e un
 * modificatore che dipende dall'insieme dei difensori scelti lo rompe. Con i
 * due metri diversi il confronto smetteva di voler dire qualcosa (la quota di
 * margine saltava dal 77% all'84% senza che nessuno giocasse meglio).
 *
 * La forma sulla linea vive in `src/lib/fanta/formazione.ts` e serve dove non
 * ha bisogno di essere separabile: nel consiglio, per dire quanto **quel**
 * difensore sposta **la tua** difesa.
 *
 * E chi non gioca non porta punti: un titolare da 8 che scende in campo meta'
 * delle volte rende meno di un 6.5 che gioca sempre, e la sostituzione vale il
 * livello di rimpiazzo.
 */
function puntiTitolari(s: Squadra, vals: ReturnType<typeof buildValuations>): number {
  let tot = 0;
  for (const r of ROLES) {
    // I titolari per ruolo sono frazionari — 3.6 difensori, 4.2 centrocampisti —
    // perche' sono la media fra i moduli ammessi. Troncare butterebbe via il
    // titolare parziale, che e' esattamente quello che distingue chi ha la rosa
    // profonda: l'ultimo slot si pesa per la sua frazione.
    const ordinati = s.presi
      .filter((p) => p.role === r)
      .sort((a, b) => b.val.effFM - a.val.effFM);
    let restano = STARTERS_PER_TEAM[r];
    for (const p of ordinati) {
      if (restano <= 0) break;
      const peso = Math.min(1, restano);
      const disponibilita = Math.min(1, Math.max(0, p.val.expApps / 34));
      tot +=
        peso *
        (disponibilita * p.val.effFM + (1 - disponibilita) * (vals.replacementFM[r] - 0.2));
      restano -= 1;
    }
    // Gli slot che non sei riuscito a riempire li gioca un rimpiazzo.
    if (restano > 0) tot += restano * (vals.replacementFM[r] - 0.2);
  }
  return tot;
}

/**
 * La squadra migliore che si poteva comprare, sapendo dopo a quanto sono andati
 * tutti.
 *
 * Irraggiungibile — nessuno conosce i prezzi in anticipo — ma dice **quanto
 * margine c'e'**: se il software e' gia' vicino, spingere oltre non paga.
 *
 * Il primo tentativo sceglieva per punti-per-credito, e dava un limite
 * superiore piu' basso di quanto il software otteneva davvero: impossibile, e
 * il segno che la misura era sbagliata. Prendere sempre il rapporto migliore
 * riempie la rosa di giocatori da un credito, che e' ottimo per il rapporto e
 * pessimo per i punti. Il problema e' uno zaino: si scelgono **esattamente**
 * gli undici titolari col budget che resta dopo aver messo un credito da parte
 * per ogni panchinaro, e si massimizzano i punti, non l'efficienza.
 */
function oracolo(
  eventi: { player_id: string; price: number }[],
  vals: ReturnType<typeof buildValuations>,
  perId: Map<string, PlayerWithStats>,
): number {
  const rimpiazzo = (r: Role) => vals.replacementFM[r] - 0.2;
  const perRuolo: RoleMap<{ prezzo: number; punti: number }[]> = { P: [], D: [], C: [], A: [] };
  for (const e of eventi) {
    const v = vals.byPlayer.get(e.player_id);
    const p = perId.get(e.player_id);
    if (!v || !p) continue;
    const r = p.role as Role;
    const disp = Math.min(1, Math.max(0, v.expApps / 34));
    perRuolo[r].push({
      prezzo: Math.max(1, e.price),
      punti: disp * v.effFM + (1 - disp) * rimpiazzo(r),
    });
  }

  // Lo zaino deve contare i titolari **come li contano le squadre**, frazioni
  // comprese. Il primo tentativo li arrotondava — quattro difensori invece di
  // 3.6, due attaccanti invece di 2.4 — e dava un limite superiore piu' basso
  // del risultato vero: non e' che il software fosse sovrumano, e' che i due
  // stavano giocando a formazioni diverse.
  //
  // Gli oggetti si ordinano per punti decrescenti, cosi' il j-esimo scelto e' il
  // j-esimo migliore e il peso della sua posizione e' noto: pieno fino
  // all'ultimo slot intero, frazionario per quello che resta.
  const panchinari = ROLES.reduce(
    (a, r) => a + DEFAULT_SLOTS[r] - Math.ceil(STARTERS_PER_TEAM[r]),
    0,
  );
  const budgetTitolari = Math.max(0, BUDGET - panchinari);

  const perRuoloDP: RoleMap<number[][]> = { P: [], D: [], C: [], A: [] };
  for (const r of ROLES) {
    const titolari = STARTERS_PER_TEAM[r];
    const k = Math.ceil(titolari);
    const peso = (posizione: number) => Math.min(1, Math.max(0, titolari - (posizione - 1)));
    const items = perRuolo[r].slice().sort((a, b) => b.punti - a.punti);

    const dp: number[][] = Array.from({ length: k + 1 }, () =>
      new Array<number>(budgetTitolari + 1).fill(-Infinity),
    );
    dp[0].fill(0);
    for (const item of items) {
      for (let j = k; j >= 1; j--) {
        const w = peso(j);
        for (let c = budgetTitolari; c >= item.prezzo; c--) {
          const cand = dp[j - 1][c - item.prezzo] + w * item.punti;
          if (cand > dp[j][c]) dp[j][c] = cand;
        }
      }
    }
    // Gli slot non riempiti li gioca un rimpiazzo, col loro stesso peso.
    for (let c = 0; c <= budgetTitolari; c++) {
      let best = -Infinity;
      for (let j = 0; j <= k; j++) {
        if (dp[j][c] === -Infinity) continue;
        let resto = 0;
        for (let q = j + 1; q <= k; q++) resto += peso(q) * rimpiazzo(r);
        best = Math.max(best, dp[j][c] + resto);
      }
      dp[k][c] = best;
      if (c > 0) dp[k][c] = Math.max(dp[k][c], dp[k][c - 1]);
    }
    perRuoloDP[r] = dp;
  }

  // Si combinano i quattro ruoli sul budget comune.
  let combinato = new Array<number>(budgetTitolari + 1).fill(-Infinity);
  combinato[0] = 0;
  for (const r of ROLES) {
    const next = new Array<number>(budgetTitolari + 1).fill(-Infinity);
    for (let speso = 0; speso <= budgetTitolari; speso++) {
      if (combinato[speso] === -Infinity) continue;
      for (let c = 0; speso + c <= budgetTitolari; c++) {
        const v = perRuoloDP[r][Math.ceil(STARTERS_PER_TEAM[r])][c];
        if (v === -Infinity) continue;
        const tot = combinato[speso] + v;
        if (tot > next[speso + c]) next[speso + c] = tot;
      }
    }
    combinato = next;
  }
  return Math.max(...combinato.filter((x) => x > -Infinity));
}

async function main() {
  const players = await carica(await login());
  const vals = buildValuations(players, {
    season: players[0]?.season ?? "2026-27",
    nParticipants: N, budget: BUDGET, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
    topPrices: { prices: [280, 240], budget: 500 },
  });

  console.log(
    `${GIRI} aste da ${N} squadre x ${BUDGET} crediti, ${players.length} giocatori.\n`,
  );

  const totali = new Map<string, { punti: number[]; residui: number[]; buchi: number[] }>();
  const oracoli: number[] = [];
  for (let g = 0; g < GIRI; g++) {
    const { squadre, eventi, perId } = simula(players, vals, 12345 + g * 977);
    oracoli.push(oracolo(eventi, vals, perId));
    for (const s of squadre) {
      const k = s.indole === "software" ? "SEGUE IL SOFTWARE" : INDOLI[s.indole].nome;
      const acc = totali.get(k) ?? { punti: [], residui: [], buchi: [] };
      acc.punti.push(puntiTitolari(s, vals));
      acc.residui.push(s.crediti);
      acc.buchi.push(slotsTotaliLiberi(s));
      totali.set(k, acc);
    }
  }

  const media = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const righe = [...totali.entries()]
    .map(([nome, v]) => ({
      nome,
      punti: media(v.punti),
      residui: media(v.residui),
      buchi: media(v.buchi),
    }))
    .sort((a, b) => b.punti - a.punti);

  console.log("chi gioca come                     punti/giornata  crediti avanzati  slot vuoti");
  for (const r of righe) {
    const evidenza = r.nome.startsWith("SEGUE") ? " <--" : "";
    console.log(
      `  ${r.nome.padEnd(32)} ${r.punti.toFixed(1).padStart(8)}  ` +
        `${r.residui.toFixed(0).padStart(14)}  ${r.buchi.toFixed(1).padStart(10)}${evidenza}`,
    );
  }

  let bad = 0;
  const assert = (l: string, ok: boolean, d?: unknown) => {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${l}`, ok ? "" : (d ?? ""));
    if (!ok) bad++;
  };
  const sw = righe.find((r) => r.nome.startsWith("SEGUE"))!;
  const altri = righe.filter((r) => !r.nome.startsWith("SEGUE"));

  const mediaOracolo = media(oracoli);
  const peggiore = Math.min(...righe.map((r) => r.punti));
  const margine = mediaOracolo - peggiore;
  console.log(
    `\n  il meglio comprabile a quei prezzi, saputo dopo: ${mediaOracolo.toFixed(1)}` +
      `  (il software prende il ${(((sw.punti - peggiore) / Math.max(0.01, margine)) * 100).toFixed(0)}%` +
      ` del margine disponibile)`,
  );

  console.log("\nquello che il consiglio deve garantire:");
  assert(
    "chi lo segue fa piu' punti di chi paga il listino",
    sw.punti > (altri.find((a) => a.nome === INDOLI.listino.nome)?.punti ?? 0),
    [sw.punti.toFixed(1), altri.map((a) => `${a.nome} ${a.punti.toFixed(1)}`)],
  );
  assert("e batte anche il piu' aggressivo", sw.punti > (altri.find((a) => a.nome === INDOLI.aggressivo.nome)?.punti ?? 0));
  assert("riempie la rosa", sw.buchi < 0.5, sw.buchi);
  assert(
    "e non lascia crediti in tasca",
    sw.residui <= BUDGET * 0.06,
    `${sw.residui.toFixed(0)} su ${BUDGET}`,
  );
  // Il margine e' la distanza fra il peggiore e il meglio comprabile sapendo i
  // prezzi dopo. Prenderne piu' della meta' e' il segno che il consiglio decide
  // davvero: sotto, sta solo seguendo il mercato.
  const quota = (sw.punti - peggiore) / Math.max(0.01, margine);
  assert("e prende piu' di meta' del margine disponibile", quota > 0.5, `${(quota * 100).toFixed(0)}%`);
  const listino = altri.find((a) => a.nome === INDOLI.listino.nome);
  if (listino) {
    const quotaListino = (listino.punti - peggiore) / Math.max(0.01, margine);
    assert(
      "cioe' molto piu' di chi paga il listino",
      quota > quotaListino * 1.5,
      `${(quota * 100).toFixed(0)}% contro ${(quotaListino * 100).toFixed(0)}%`,
    );
  }
  // ------------------------------------------------------------------ rilanci
  //
  // Alzare il prezzo a un avversario e' la mossa piu' facile da raccontare e la
  // piu' facile da sbagliare: ogni credito che gli togli e' un credito che lui
  // non avra' dopo, ma se molla il giocatore resta a te. Qui la stessa asta
  // viene rigiocata tre volte, identica, cambiando solo questo.
  console.log("\nalzare il prezzo agli avversari, conviene?\n");
  const modi: ModoRilancio[] = ["mai", "al buio", "con la voce"];
  const esiti = new Map<
    ModoRilancio,
    { punti: number[]; residui: number[]; regalati: number[]; volte: number[]; risparmiate: number[] }
  >();
  for (const modo of modi) {
    const acc = {
      punti: [] as number[], residui: [] as number[], regalati: [] as number[],
      volte: [] as number[], risparmiate: [] as number[],
    };
    for (let g = 0; g < GIRI; g++) {
      const { squadre, spia } = simula(players, vals, 12345 + g * 977, modo);
      acc.volte.push(spia.volte);
      acc.risparmiate.push(spia.risparmiate);
      const io = squadre.find((s) => s.indole === "software")!;
      acc.punti.push(puntiTitolari(io, vals));
      acc.residui.push(io.crediti);
      // Quanto hanno speso gli altri: e' il conto che il rilancio vuole gonfiare.
      acc.regalati.push(
        squadre.filter((s) => s.indole !== "software").reduce((a, s) => a + (BUDGET - s.crediti), 0) /
          (N - 1),
      );
    }
    esiti.set(modo, acc);
  }
  console.log(
    "  come alzo         miei punti/giornata  spesa degli altri  volte  crediti risparmiati",
  );
  for (const modo of modi) {
    const e = esiti.get(modo)!;
    console.log(
      `  ${modo.padEnd(16)} ${media(e.punti).toFixed(1).padStart(19)}  ${media(e.regalati).toFixed(0).padStart(17)}  ` +
        `${media(e.volte).toFixed(0).padStart(5)}  ${media(e.risparmiate).toFixed(0).padStart(19)}`,
    );
  }
  const senza = media(esiti.get("mai")!.punti);
  const conVoce = media(esiti.get("con la voce")!.punti);
  const alBuio = media(esiti.get("al buio")!.punti);
  console.log(
    `\n  al buio ${(alBuio - senza >= 0 ? "+" : "") + (alBuio - senza).toFixed(1)} punti, ` +
      `con la voce ${(conVoce - senza >= 0 ? "+" : "") + (conVoce - senza).toFixed(1)} punti ` +
      `rispetto a non alzare mai.`,
  );
  // Il tetto degli avversari serve soprattutto a fermarsi prima. Se pero' e'
  // sottostimato si perdono giocatori che si volevano: questa e' la prova che
  // la correzione su quanto hanno gia' pagato tiene.
  // Un decimo di punto su sei aste e' rumore, non un effetto: la richiesta e'
  // che non faccia danno, non che vinca una gara di arrotondamenti.
  assert(
    "fermarsi al tetto degli avversari non fa perdere punti",
    conVoce >= senza - 0.1,
    `${conVoce.toFixed(2)} contro ${senza.toFixed(2)}`,
  );
  // Fermarsi al tetto degli avversari non e' piu' una variante: e' il
  // comportamento normale del motore, quindi qui non c'e' piu' un risparmio
  // "in piu'" da misurare. Che sia attivo e non faccia danno lo dice la riga
  // sopra; quanto muove i consigli lo misura `npm run check:contesto`.
  assert(
    "e sapere chi rilancia e' meglio che tirare a indovinare",
    conVoce >= alBuio - 0.1,
    `${conVoce.toFixed(2)} contro ${alBuio.toFixed(2)}`,
  );

  console.log(bad === 0 ? "\nIL CONSIGLIO REGGE\n" : `\n${bad} PROBLEMI\n`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
