/**
 * Le coppe e i campionati stranieri aiutano a prevedere la Serie A?
 *
 * Nel fantacalcio contano solo le partite di Serie A. Le altre competizioni
 * entrano nel calcolo per un motivo preciso — chi arriva dall'estero non ha
 * nessuna riga italiana, e senza di loro non si saprebbe niente di lui — ma per
 * chi la Serie A l'ha gia' giocata sono un'aggiunta, e le aggiunte vanno
 * misurate.
 *
 * C'e' un dettaglio che le rende sospette: **nessuna riga fuori dalla Serie A ha
 * la media voto**. Champions, Coppa Italia e campionati stranieri portano solo
 * gol, assist e cartellini. Entrano quindi nel calcolo dei tassi per presenza
 * senza portare niente al voto — e un attaccante che in Champions segna il
 * doppio si porta dietro quel ritmo in una stima che riguarda il campionato.
 *
 * Qui si prende il motore vero, gli si da' la storia fino al 2024-25 in due
 * versioni — con tutto e con la sola Serie A — e si guarda quale delle due
 * indovina meglio la fantamedia di Serie A del 2025-26.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:campionati
 */
import { buildValuations } from "../src/lib/fanta/valuation";
import { SERIE_A_KEY } from "../src/lib/fanta/competitions";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  type PlayerStatsRow,
  type PlayerWithStats,
} from "../src/lib/fanta/types";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const FINO_A = "2024-25";
const BERSAGLIO = "2025-26";

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
    for (const row of chunk as (PlayerWithStats & { player_stats: PlayerStatsRow[] })[]) {
      const { player_stats, ...resto } = row;
      const history = (player_stats ?? []).slice().sort((a, b) => (a.season < b.season ? 1 : -1));
      out.push({ ...(resto as PlayerWithStats), history, stats: history[0] ?? null });
    }
    if (chunk.length < 1000) break;
  }
  return out;
}

const soloSerieA = (h: PlayerStatsRow) => (h.competition ?? SERIE_A_KEY) === SERIE_A_KEY;

function taglia(pool: PlayerWithStats[], tieniAltre: boolean): PlayerWithStats[] {
  return pool.map((p) => {
    const history = (p.history ?? []).filter(
      (h) => h.season <= FINO_A && (tieniAltre || soloSerieA(h)),
    );
    return { ...p, history, stats: history[0] ?? null };
  });
}

function valuta(pool: PlayerWithStats[]) {
  return buildValuations(pool, {
    // La stagione "in corso" e' quella che stiamo prevedendo, e nelle storie
    // tagliate non c'e': cosi' il motore non vede niente del bersaglio.
    season: BERSAGLIO,
    nParticipants: 8,
    budget: 500,
    slots: DEFAULT_SLOTS,
    rules: DEFAULT_RULES,
    topPrices: { prices: [280, 240], budget: 500 },
  });
}

async function main() {
  const pool = await carica(await login());

  // Il bersaglio: la fantamedia di Serie A del 2025-26, di chi l'ha giocata
  // abbastanza da voler dire qualcosa.
  const bersaglio = new Map<string, { fm: number; presenze: number }>();
  for (const p of pool) {
    const r = (p.history ?? []).find(
      (h) => h.season === BERSAGLIO && soloSerieA(h) && h.matches >= 10 && h.avg_fantavote != null,
    );
    if (r) bersaglio.set(p.id, { fm: Number(r.avg_fantavote), presenze: r.matches });
  }

  const conTutto = valuta(taglia(pool, true));
  const soloItalia = valuta(taglia(pool, false));

  // Chi aveva davvero altre competizioni nella storia usata, e chi no.
  const conAltre = new Set(
    pool
      .filter((p) => (p.history ?? []).some((h) => h.season <= FINO_A && !soloSerieA(h)))
      .map((p) => p.id),
  );
  const conSerieA = new Set(
    pool
      .filter((p) =>
        (p.history ?? []).some((h) => h.season <= FINO_A && soloSerieA(h) && h.matches >= 10),
      )
      .map((p) => p.id),
  );

  const gruppi: [string, (id: string) => boolean][] = [
    ["tutti quelli con un bersaglio", () => true],
    ["ha giocato altre competizioni", (id) => conAltre.has(id)],
    ["  ...e aveva gia' la Serie A", (id) => conAltre.has(id) && conSerieA.has(id)],
    ["  ...e la Serie A non ce l'aveva", (id) => conAltre.has(id) && !conSerieA.has(id)],
  ];

  console.log(
    `\nStoria fino al ${FINO_A}, bersaglio la fantamedia di Serie A ${BERSAGLIO}.\n` +
      `${bersaglio.size} giocatori con almeno 10 presenze nel ${BERSAGLIO}.\n`,
  );
  console.log("  gruppo                             quanti   con tutto   solo Serie A   meglio");
  for (const [nome, dentro] of gruppi) {
    let n = 0;
    let errTutto = 0;
    let errItalia = 0;
    for (const [id, b] of bersaglio) {
      if (!dentro(id)) continue;
      const a = conTutto.byPlayer.get(id);
      const c = soloItalia.byPlayer.get(id);
      if (!a || !c) continue;
      n++;
      errTutto += Math.abs(a.expFM - b.fm);
      errItalia += Math.abs(c.expFM - b.fm);
    }
    if (n === 0) continue;
    const t = errTutto / n;
    const i = errItalia / n;
    console.log(
      `  ${nome.padEnd(34)} ${n.toString().padStart(6)}   ${t.toFixed(3).padStart(9)}   ` +
        `${i.toFixed(3).padStart(12)}   ${i < t ? "SOLO SERIE A" : t < i ? "con tutto" : "pari"}`,
    );
  }

  // Dove si vede meglio: chi in coppa ha segnato a un ritmo diverso.
  console.log("\n  I casi in cui le due stime si allontanano di piu':\n");
  const scarti = [...bersaglio.keys()]
    .map((id) => {
      const a = conTutto.byPlayer.get(id);
      const c = soloItalia.byPlayer.get(id);
      const p = pool.find((x) => x.id === id);
      return a && c && p ? { p, a, c, d: a.expFM - c.expFM } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 8);
  for (const s of scarti) {
    const vero = bersaglio.get(s.p.id)!;
    console.log(
      `    ${s.p.name.padEnd(20)} con tutto ${s.a.expFM.toFixed(2)}  solo Serie A ${s.c.expFM.toFixed(2)}  ` +
        `-> ha fatto ${vero.fm.toFixed(2)}`,
    );
  }
  // ------------------------------------------------------------------ coppe
  //
  // L'ipotesi: chi gioca anche le coppe infrasettimanali arriva piu' stanco in
  // campionato, e la sua fantamedia ne risente l'anno dopo. E' un effetto di
  // squadra piu' che di persona — chi e' in Europa gioca ogni tre giorni
  // tutto l'anno — ma se esiste si deve vedere sul singolo.
  console.log("\n== Le coppe stancano? ==\n");
  const EUROPEE = new Set(["champions-league", "europa-league", "conference-league"]);
  type Caso = { nome: string; extra: number; prima: number; dopo: number };
  const casi: Caso[] = [];
  for (const p of pool) {
    const h = p.history ?? [];
    const prima = h.find((x) => x.season === FINO_A && soloSerieA(x) && x.matches >= 15);
    const dopo = h.find((x) => x.season === BERSAGLIO && soloSerieA(x) && x.matches >= 15);
    if (!prima || !dopo || prima.avg_fantavote == null || dopo.avg_fantavote == null) continue;
    const extra = h
      .filter((x) => x.season === FINO_A && EUROPEE.has(x.competition ?? ""))
      .reduce((a, x) => a + x.matches, 0);
    casi.push({
      nome: p.name,
      extra,
      prima: Number(prima.avg_fantavote),
      dopo: Number(dopo.avg_fantavote),
    });
  }
  const media = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  console.log("  partite di coppa    quanti   fantamedia prima -> dopo   variazione");
  for (const [nome, dentro] of [
    ["nessuna", (c: Caso) => c.extra === 0],
    ["da 1 a 5", (c: Caso) => c.extra >= 1 && c.extra <= 5],
    ["da 6 a 10", (c: Caso) => c.extra >= 6 && c.extra <= 10],
    ["piu' di 10", (c: Caso) => c.extra > 10],
  ] as const) {
    const g = casi.filter(dentro);
    if (g.length < 5) continue;
    const a = media(g.map((c) => c.prima));
    const b = media(g.map((c) => c.dopo));
    console.log(
      `  ${nome.padEnd(18)} ${g.length.toString().padStart(6)}   ${a.toFixed(2)} -> ${b.toFixed(2)}` +
        `              ${(b - a >= 0 ? "+" : "") + (b - a).toFixed(2)}`,
    );
  }
  console.log(
    "\n  Attenzione a leggerlo: chi gioca le coppe gioca in una squadra piu' forte,\n" +
      "  quindi parte da una fantamedia piu' alta e ha piu' spazio per scendere. Il\n" +
      "  confronto giusto sarebbe lo stesso giocatore con e senza coppe, e per farlo\n" +
      "  servirebbero due stagioni con il dettaglio per competizione: ne abbiamo una.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
