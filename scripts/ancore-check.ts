/**
 * Quanto cambia il listino se la taratura usa i prezzi veri.
 *
 * Non e' un controllo permanente: e' una misura da fare quando arrivano i
 * prezzi di un'asta vera, per vedere di quanto ci si era sbagliati.
 */
import { buildValuations } from "../src/lib/fanta/valuation";
import { DEFAULT_RULES, DEFAULT_SLOTS, type PlayerStatsRow, type PlayerWithStats } from "../src/lib/fanta/types";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function login() {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const s = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(s));
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

async function main() {
  const players = await carica(await login());
  const prova = (nome: string, prices: number[] | null) => {
    const v = buildValuations(players, {
      season: players[0]?.season ?? "2026-27",
      nParticipants: 8,
      budget: 500,
      slots: DEFAULT_SLOTS,
      rules: DEFAULT_RULES,
      topPrices: prices ? { prices, budget: 500 } : undefined,
    });
    const ordinati = [...v.byPlayer.values()].sort((a, b) => b.baseValue - a.baseValue);
    // Il confronto giusto e' sui 200 che vengono davvero comprati (8 squadre
    // per 25 slot): gli altri 333 non hanno un prezzo di mercato, hanno un
    // prezzo di listino, e mescolarli sposta la mediana dove vuoi tu.
    const comprati = ordinati.slice(0, 200);
    const primi = comprati.slice(0, 10).map((x) => Math.round(x.baseValue));
    const mediana = Math.round(comprati[Math.floor(comprati.length / 2)].baseValue);
    const sotto5 = comprati.filter((x) => x.baseValue <= 5).length;
    const somma = Math.round(comprati.reduce((a, x) => a + x.baseValue, 0));
    console.log(
      `  ${nome.padEnd(34)} primi dieci ${primi.join(", ")}\n` +
        `  ${" ".repeat(34)} mediana ${mediana}, a 5 crediti o meno ${sotto5}/200, somma ${somma}`,
    );
    return ordinati;
  };

  console.log("\nCome cambia il listino del software al variare della taratura:\n");
  prova("con [280, 240] (quello di adesso)", [280, 240]);
  console.log();
  prova("con i prezzi veri del 2025-26", [181, 170, 153, 118, 117]);
  console.log();
  prova("senza ancore (solo listino ufficiale)", null);
  console.log(
    "\nL'asta vera: 199 giocatori, 3810 crediti, il piu' caro 181, mediana 8,\n" +
      "86 giocatori su 199 a cinque crediti o meno.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
