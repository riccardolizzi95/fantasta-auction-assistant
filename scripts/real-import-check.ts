/**
 * Esegue l'intero percorso d'importazione con i file ufficiali veri, contro il
 * database vero, replicando esattamente quello che fa /api/import.
 *
 * Serve a verificare le due cose che i test sintetici non possono toccare: che
 * l'upsert trovi i vincoli giusti e che i nomi dei file ufficiali si aggancino
 * davvero al listone.
 */
import WebSocket from "ws";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { matchStatsToPlayers, parseWorkbook } from "../src/lib/fanta/importer";
import { buildValuations } from "../src/lib/fanta/valuation";
import { DEFAULT_RULES, DEFAULT_SLOTS, ROLES, type PlayerWithStats, type PlayerStatsRow, type PlayerRow } from "../src/lib/fanta/types";

(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;

const SEASON = "2026-27";
const DIR = `${process.env.HOME}/Downloads/`;
const FILES = {
  quotazioni: "Quotazioni_Fantacalcio_Stagione_2026_27.xlsx",
  stats: [
    { file: "Statistiche_Fantacalcio_Stagione_2026_27.xlsx", season: "2026-27" },
    { file: "Statistiche_Fantacalcio_Stagione_2025_26.xlsx", season: "2025-26" },
    { file: "Statistiche_Fantacalcio_Stagione_2024_25.xlsx", season: "2024-25" },
  ],
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

const buf = (name: string) => {
  const b = readFileSync(DIR + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

async function main() {
  for (const f of [FILES.quotazioni, ...FILES.stats.map((s) => s.file)]) {
    if (!existsSync(DIR + f)) throw new Error(`File mancante: ${DIR + f}`);
  }

  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_EMAIL!,
    password: process.env.TEST_PASSWORD!,
  });
  if (authErr) throw new Error(`Login fallito: ${authErr.message}`);

  // ---------------------------------------------------------------- listone
  console.log("\n== Listone ==");
  const quot = parseWorkbook(buf(FILES.quotazioni), "quotazioni");
  if (quot.kind !== "quotazioni") throw new Error("File quotazioni non riconosciuto");
  const rows = quot.players.map((p) => ({
    season: SEASON,
    external_id: p.external_id,
    name: p.name,
    team: p.team,
    role: p.role,
    role_mantra: p.role_mantra,
    quotation_initial: p.quotation_initial,
    quotation_current: p.quotation_current,
    fvm: p.fvm,
    is_active: true,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("players")
      .upsert(rows.slice(i, i + 500), { onConflict: "season,external_id" });
    if (error) throw new Error(`Upsert listone: ${error.message}`);
  }
  const ids = rows.map((r) => r.external_id).filter((x): x is number => x != null);
  const { data: gone, error: deErr } = await supabase
    .from("players")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("season", SEASON)
    .eq("is_active", true)
    .not("external_id", "in", `(${ids.join(",")})`)
    .select("id, name");
  if (deErr) throw new Error(`Disattivazione: ${deErr.message}`);
  console.log(`  ${rows.length} giocatori importati, ${gone?.length ?? 0} disattivati (non piu' in Serie A)`);

  const { data: listone } = await supabase
    .from("players")
    .select("id, external_id, name, team, role")
    .eq("season", SEASON)
    .eq("is_active", true);
  console.log(`  listone attivo: ${listone?.length}`);

  // ------------------------------------------------------------ statistiche
  for (const { file, season } of FILES.stats) {
    const parsed = parseWorkbook(buf(file), "statistiche");
    if (parsed.kind !== "statistiche") throw new Error(`${file} non riconosciuto`);
    const { matches, unmatched, matchedBy } = matchStatsToPlayers(parsed.stats, listone ?? []);
    const statRows = matches.map(({ playerId, stats: s }) => ({
      player_id: playerId,
      season,
      competition: "serie-a",
      source: "import",
      matches: s.matches,
      avg_vote: s.avg_vote,
      avg_fantavote: s.avg_fantavote,
      goals: s.goals,
      goals_conceded: s.goals_conceded,
      assists: s.assists,
      yellow_cards: s.yellow_cards,
      red_cards: s.red_cards,
      own_goals: s.own_goals,
      pen_saved: s.pen_saved,
      pen_scored: s.pen_scored,
      pen_missed: s.pen_missed,
    }));
    const deduped = [...new Map(statRows.map((r) => [r.player_id, r])).values()];
    for (let i = 0; i < deduped.length; i += 500) {
      const { error } = await supabase
        .from("player_stats")
        .upsert(deduped.slice(i, i + 500), { onConflict: "player_id,season,competition" });
      if (error) throw new Error(`Upsert statistiche ${season}: ${error.message}`);
    }
    console.log(
      `\n== Statistiche ${season} ==\n  ${deduped.length} salvate ` +
        `(${matchedBy.id} per Id, ${matchedBy.nameTeam} per nome+squadra, ${matchedBy.name} per nome)` +
        `\n  ${unmatched.length} non nel listone, ignorati` +
        (unmatched.length ? `: ${unmatched.slice(0, 5).join(", ")}…` : ""),
    );
  }

  // ------------------------------------------------------------------ motore
  console.log("\n== Il motore sui dati veri ==");
  const all: PlayerWithStats[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("players")
      .select("id, season, external_id, name, team, role, quotation_initial, quotation_current, fvm, is_active, player_stats(*)")
      .eq("season", SEASON)
      .eq("is_active", true)
      .order("name")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []).map((row) => {
      const { player_stats, ...rest } = row as typeof row & { player_stats: PlayerStatsRow[] };
      const history = (player_stats ?? []).slice().sort((a, b) => (a.season < b.season ? 1 : -1));
      return { ...(rest as unknown as PlayerRow), stats: history[0] ?? null, history } as PlayerWithStats;
    });
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  console.log(`  ${all.length} giocatori con ${all.reduce((a, p) => a + p.history.length, 0)} righe statistiche`);

  const vals = buildValuations(all, {
    season: SEASON, nParticipants: 8, budget: 500, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES,
  });
  console.log(`  giornate rilevate: ${vals.matchdaysPlayed}`);

  const totalByRole = { P: 0, D: 0, C: 0, A: 0 };
  for (const r of ROLES) {
    totalByRole[r] = vals.byRole[r].slice(0, 8 * DEFAULT_SLOTS[r]).reduce((a, v) => a + v.baseValue, 0);
  }
  const grand = ROLES.reduce((a, r) => a + totalByRole[r], 0);
  console.log(`\n  Quota di mercato per reparto (8 squadre, 500 crediti):`);
  for (const r of ROLES) {
    console.log(`   ${r}  ${((totalByRole[r] / grand) * 100).toFixed(1)}%   rimpiazzo FM ${vals.replacementFM[r].toFixed(2)}`);
  }
  console.log(`\n  I dieci piu' cari:`);
  const top = [...vals.byPlayer.entries()]
    .sort((a, b) => b[1].baseValue - a[1].baseValue)
    .slice(0, 10);
  for (const [id, v] of top) {
    const p = all.find((x) => x.id === id)!;
    console.log(
      `   ${p.name.padEnd(22)} ${p.team.padEnd(11)} ${p.role}  ` +
        `${Math.round(v.baseValue).toString().padStart(3)} cr   ` +
        `FM ${v.expFM.toFixed(2)}  pres ${Math.round(v.expApps)}  listino ${Math.round(v.marketPrice)}`,
    );
  }
  const senzaDati = all.filter((p) => !p.history.some((h) => h.season !== SEASON && h.matches >= 5));
  console.log(`\n  Senza storico di Serie A concluso: ${senzaDati.length} su ${all.length}`);
  console.log(
    `  I piu' quotati fra questi: ` +
      senzaDati
        .sort((a, b) => Number(b.quotation_current ?? 0) - Number(a.quotation_current ?? 0))
        .slice(0, 8)
        .map((p) => `${p.name} (${p.team}, ${p.quotation_current})`)
        .join(", "),
  );
}

main().catch((e) => {
  console.error("\nERRORE:", e.message);
  process.exit(1);
});
