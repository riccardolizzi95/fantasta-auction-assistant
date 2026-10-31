/**
 * Test di integrazione end-to-end contro il database reale.
 * Verifica autenticazione, RLS, trigger, RPC e il motore di consiglio su una
 * stagione fittizia ("TEST"), che viene ripulita a fine corsa.
 */
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";

// Node 20 non ha WebSocket nativo: serve al client Supabase anche se qui il
// realtime non lo usiamo.
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;
import { buildValuations } from "../src/lib/fanta/valuation";
import { buildMarketState } from "../src/lib/fanta/market";
import { recommend } from "../src/lib/fanta/recommend";
import { reviewStrategies } from "../src/lib/fanta/review";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLES,
  type LeagueRow,
  type ParticipantRow,
  type PlayerRow,
  type PlayerWithStats,
  type Role,
  type AuctionEventRow,
} from "../src/lib/fanta/types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ADMIN_EMAIL = process.env.TEST_EMAIL!;
const ADMIN_PASSWORD = process.env.TEST_PASSWORD!;
const SEASON = "TEST-2627";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

const anon = () => createClient(URL, KEY, { auth: { persistSession: false } });

async function main() {
  console.log("\n== 1. Autenticazione ==");
  const admin = anon();
  const { data: auth, error: authErr } = await admin.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  check("login amministratore", !authErr && !!auth?.user, authErr?.message);
  if (!auth?.user) return;
  const adminId = auth.user.id;

  const { data: profile } = await admin.from("profiles").select("*").eq("id", adminId).single();
  check("profilo creato dal trigger", !!profile, profile);
  check("flag amministratore", profile?.is_admin === true);

  console.log("\n== 1b. Registrazione pubblica ==");
  const stranger = anon();
  const { error: signupErr } = await stranger.auth.signUp({
    email: `intruso-${Date.now()}@fantasta.local`,
    password: "provapassword123",
  });
  check("chiunque abbia la chiave anon non puo' registrarsi", !!signupErr, signupErr?.message);

  console.log("\n== 2. Listone (scrittura riservata agli admin) ==");
  await admin.from("players").delete().eq("season", SEASON);
  const pool = makePool();
  const { error: insErr } = await admin.from("players").insert(
    pool.map((p) => ({
      season: SEASON,
      external_id: p.external_id,
      name: p.name,
      team: p.team,
      role: p.role,
      quotation_initial: p.quotation_initial,
      quotation_current: p.quotation_current,
      fvm: p.fvm,
    })),
  );
  check("inserimento listone", !insErr, insErr?.message);

  const { data: dbPlayers } = await admin
    .from("players")
    .select("id, external_id, name, team, role, quotation_initial, quotation_current, fvm, season, is_active")
    .eq("season", SEASON);
  check(`${pool.length} giocatori riletti`, (dbPlayers?.length ?? 0) === pool.length, dbPlayers?.length);

  const byExt = new Map(dbPlayers!.map((p) => [p.external_id!, p.id]));
  const { error: statsErr } = await admin.from("player_stats").insert(
    pool.map((p) => ({ ...p.stats!, player_id: byExt.get(p.external_id!)!, season: "TEST-2526" })),
  );
  check("inserimento statistiche", !statsErr, statsErr?.message);

  console.log("\n== 3. Lega, trigger e strategia ==");
  const { data: league, error: leagueErr } = await admin
    .from("leagues")
    .insert({
      name: "Lega di prova",
      owner_id: adminId,
      season: SEASON,
      budget: 500,
      n_participants: 8,
      slots: DEFAULT_SLOTS,
      rules: { ...DEFAULT_RULES, defense_modifier: true },
    })
    .select("*")
    .single();
  check("creazione lega", !leagueErr && !!league, leagueErr?.message);
  if (!league) return;

  const { data: members } = await admin.from("league_members").select("*").eq("league_id", league.id);
  check("il creatore e' membro (trigger)", members?.length === 1 && members[0].role === "owner");

  const { data: parts0 } = await admin.from("participants").select("*").eq("league_id", league.id);
  check("il creatore e' partecipante (trigger)", parts0?.length === 1 && parts0[0].user_id === adminId);
  const myParticipantId = parts0![0].id;

  const rivals = ["Marco", "Luca", "Giulia", "Andrea", "Sara", "Paolo", "Elena"];
  const { data: added, error: addErr } = await admin
    .from("participants")
    .insert(rivals.map((name) => ({ league_id: league.id, name, budget_total: 500 })))
    .select("*");
  check("aggiunta avversari", !addErr && added?.length === 7, addErr?.message);

  const { error: stratErr } = await admin.from("strategies").insert({
    league_id: league.id,
    participant_id: myParticipantId,
    key: "attacco_forte",
    label: "Attacco corazzato",
    budget_split: { P: 0.05, D: 0.12, C: 0.28, A: 0.55 },
    tier_targets: { P: 0, D: 0, C: 1, A: 2 },
    is_active: true,
  });
  check("strategia salvata", !stratErr, stratErr?.message);

  console.log("\n== 4. Secondo utente, invito e isolamento dei dati ==");
  const guestEmail = `test-guest-${Date.now()}@fantasta.local`;
  const guestPassword = "prova-integrazione-8891";
  const { data: guestId, error: createErr } = await admin.rpc("admin_create_user", {
    p_email: guestEmail,
    p_password: guestPassword,
    p_display_name: "Ospite",
    p_is_admin: false,
  });
  check("creazione account da admin", !createErr && !!guestId, createErr?.message);

  const guest = anon();
  const { error: guestAuthErr } = await guest.auth.signInWithPassword({
    email: guestEmail,
    password: guestPassword,
  });
  check("login del nuovo account", !guestAuthErr, guestAuthErr?.message);

  const { data: beforeJoin } = await guest.from("leagues").select("id").eq("id", league.id);
  check("senza invito la lega non e' visibile", (beforeJoin?.length ?? 0) === 0);

  const { data: joinedId, error: joinErr } = await guest.rpc("join_league", {
    p_code: league.invite_code,
  });
  check("ingresso con codice invito", !joinErr && joinedId === league.id, joinErr?.message);

  const { data: afterJoin } = await guest.from("leagues").select("id, name").eq("id", league.id);
  check("dopo l'invito la lega e' visibile", afterJoin?.length === 1);

  const { data: guestSeesStrategies } = await guest
    .from("strategies")
    .select("id")
    .eq("league_id", league.id);
  check("la strategia altrui resta privata", (guestSeesStrategies?.length ?? 0) === 0, guestSeesStrategies);

  const { error: guestWriteErr } = await guest
    .from("players")
    .insert({ season: SEASON, name: "Intruso", team: "X", role: "A" });
  check("un non-admin non puo' scrivere sul listone", !!guestWriteErr, guestWriteErr?.message);

  const { error: guestAdminErr } = await guest.rpc("admin_create_user", {
    p_email: "hacker@x.it",
    p_password: "12345678",
  });
  check("un non-admin non puo' creare account", !!guestAdminErr, guestAdminErr?.message);

  console.log("\n== 4a. Chi entra nella lega non la amministra ==");
  // Entrare col codice invito dava anche il potere di aggiungere e soprattutto
  // **cancellare** le squadre altrui, e di riscrivere le regole della lega: la
  // regola su `participants` era una sola, ALL per qualunque membro.
  const { error: aggiungiErr } = await guest
    .from("participants")
    .insert({ league_id: league.id, name: "Aggiunto di nascosto", budget_total: 500 });
  check("un membro non puo' aggiungere squadre", !!aggiungiErr, aggiungiErr?.message);

  // Una cancellazione vietata da RLS non da' errore: tocca zero righe. Va
  // verificata rileggendo, non fidandosi della risposta.
  const vittima = added![0].id;
  await guest.from("participants").delete().eq("id", vittima);
  const { data: sopravvissuta } = await admin.from("participants").select("id").eq("id", vittima);
  check("un membro non puo' cancellare squadre altrui", sopravvissuta?.length === 1);

  await guest.from("leagues").update({ name: "Lega dirottata", budget: 9999 }).eq("id", league.id);
  const { data: legaDopo } = await admin
    .from("leagues")
    .select("name, budget")
    .eq("id", league.id)
    .single();
  check(
    "un membro non puo' cambiare le regole della lega",
    legaDopo?.name === "Lega di prova" && legaDopo?.budget === 500,
    legaDopo,
  );

  // Quello che invece deve restare possibile a chiunque.
  const { data: suaRiga } = await guest
    .from("participants")
    .select("id")
    .eq("league_id", league.id)
    .eq("user_id", guestId)
    .single();
  await guest.from("participants").update({ name: "Ospite in trasferta" }).eq("id", suaRiga!.id);
  const { data: rinominata } = await admin
    .from("participants")
    .select("name")
    .eq("id", suaRiga!.id)
    .single();
  check("ma puo' rinominare la propria squadra", rinominata?.name === "Ospite in trasferta");

  const { error: eventoErr } = await guest.from("auction_events").insert({
    league_id: league.id,
    player_id: dbPlayers![0].id,
    participant_id: suaRiga!.id,
    price: 10,
    outcome: "assigned",
  });
  check("e puo' registrare quello che succede all'asta", !eventoErr, eventoErr?.message);
  await admin.from("auction_events").delete().eq("league_id", league.id);

  console.log("\n== 4b. Statistiche da un altro campionato ==");
  const foreigner = dbPlayers!.find((p) => p.role === "A")!;
  const { error: extErr } = await admin.from("player_stats").upsert(
    {
      player_id: foreigner.id,
      season: "TEST-2425",
      competition: "eredivisie",
      source: "api",
      rating: 7.4,
      matches: 32,
      minutes: 2700,
      goals: 20,
      assists: 6,
      yellow_cards: 3,
      red_cards: 0,
      own_goals: 0,
      pen_scored: 4,
      pen_missed: 1,
      pen_saved: 0,
      goals_conceded: 0,
      clean_sheets: 0,
      club: "Ajax",
    },
    { onConflict: "player_id,season,competition,club" },
  );
  check("riga di un campionato estero salvata", !extErr, extErr?.message);

  const { data: extRows } = await admin
    .from("player_stats")
    .select("competition, source, rating, goals, club")
    .eq("player_id", foreigner.id)
    .eq("season", "TEST-2425");
  check(
    "competizione, fonte e squadra conservate",
    extRows?.[0]?.competition === "eredivisie" &&
      extRows?.[0]?.source === "api" &&
      extRows?.[0]?.club === "Ajax",
    extRows,
  );
  check(
    "la stessa stagione puo' avere piu' competizioni",
    !(await admin.from("player_stats").upsert(
      {
        player_id: foreigner.id, season: "TEST-2425", competition: "champions-league",
        source: "api", matches: 8, goals: 3, assists: 1, minutes: 600,
        yellow_cards: 0, red_cards: 0, own_goals: 0, pen_scored: 0, pen_missed: 0,
        pen_saved: 0, goals_conceded: 0, clean_sheets: 0, club: "Ajax",
      },
      { onConflict: "player_id,season,competition,club" },
    )).error,
  );

  // Due squadre nella stessa stagione e nello stesso campionato sono **due
  // righe**: chi cambia squadra a gennaio ha giocato due mezze stagioni
  // diverse, e sommarle in una sola cancellava proprio l'informazione che
  // all'asta si guarda.
  const { error: errGennaio } = await admin.from("player_stats").upsert(
    {
      player_id: foreigner.id, season: "TEST-2425", competition: "eredivisie",
      source: "api", matches: 14, goals: 4, assists: 2, minutes: 1100,
      yellow_cards: 1, red_cards: 0, own_goals: 0, pen_scored: 0, pen_missed: 0,
      pen_saved: 0, goals_conceded: 0, clean_sheets: 0, club: "Feyenoord",
    },
    { onConflict: "player_id,season,competition,club" },
  );
  const { data: dueSquadre } = await admin
    .from("player_stats")
    .select("club, matches")
    .eq("player_id", foreigner.id)
    .eq("season", "TEST-2425")
    .eq("competition", "eredivisie");
  check(
    "due squadre nella stessa stagione restano due righe",
    !errGennaio && dueSquadre?.length === 2,
    errGennaio?.message ?? dueSquadre,
  );

  console.log("\n== 5. Asta e motore ==");
  const players: PlayerWithStats[] = dbPlayers!.map((p) => {
    const src = pool.find((x) => x.external_id === p.external_id)!;
    const stats = { ...src.stats!, player_id: p.id, season: "TEST-2526", competition: "serie-a" };
    return { ...(p as unknown as PlayerRow), stats, history: [stats] };
  });
  const { data: partsAll } = await admin.from("participants").select("*").eq("league_id", league.id);
  // Con l'ospite entrato i partecipanti sono nove: le valutazioni devono
  // basarsi su quelli reali, altrimenti i crediti in gioco non tornano.
  const vals = buildValuations(players, {
    season: SEASON,
    nParticipants: partsAll!.length,
    budget: 500,
    slots: DEFAULT_SLOTS,
    rules: league.rules,
  });

  // Gli avversari si prendono i sei attaccanti migliori pagandoli il 35% in piu'.
  const topA = vals.byRole.A.slice(0, 6);
  const events = topA.map((v, i) => ({
    league_id: league.id,
    player_id: v.playerId,
    participant_id: added![i % added!.length].id,
    price: Math.round(v.baseValue * 1.35),
    outcome: "assigned" as const,
  }));
  const { error: evErr } = await admin.from("auction_events").insert(events);
  check("registrazione acquisti", !evErr, evErr?.message);

  const { data: evRows } = await admin.from("auction_events").select("*").eq("league_id", league.id);
  check("acquisti riletti", evRows?.length === 6);

  const { error: dupErr } = await admin.from("auction_events").insert({
    league_id: league.id,
    player_id: topA[0].playerId,
    participant_id: myParticipantId,
    price: 10,
    outcome: "assigned",
  });
  check("un giocatore non puo' essere assegnato due volte", !!dupErr, dupErr?.message);

  const state = buildMarketState({
    league: league as LeagueRow,
    participants: partsAll as ParticipantRow[],
    events: (evRows ?? []) as AuctionEventRow[],
    players: new Map(players.map((p) => [p.id, p])),
    valuations: vals.byPlayer,
    myParticipantId,
  });
  check("i crediti degli avversari sono scesi", state.teams.some((t) => t.remaining < 500));
  check("i miei crediti sono intatti", state.me?.remaining === 500);
  check(
    "l'asta va a sconto dopo gli acquisti sopra valore",
    state.inflation < 1,
    state.inflation.toFixed(3),
  );

  const candidate = players.find((p) => p.id === vals.byRole.A[6].playerId)!;
  const rec = recommend({
    player: candidate,
    state,
    valuations: vals,
    allPlayers: players,
    strategyKey: "attacco_forte",
  });
  check("prezzo consigliato positivo", rec.fair > 0 && rec.max > 0, rec);
  check("il tetto non supera i crediti disponibili", rec.max <= state.me!.maxBid);
  check("il prezzo di apertura non supera il tetto", rec.target <= rec.max);
  check("il consiglio ha una motivazione", rec.pros.length + rec.cons.length + rec.notes.length > 0);
  console.log(`       -> ${candidate.name}: giusto ${rec.fair}, apri ${rec.target}, max ${rec.max} (${rec.verdict})`);

  const review = reviewStrategies({
    state,
    valuations: vals,
    allPlayers: players,
    activeKey: "attacco_forte",
  });
  check("tutte le strategie valutate", review.ranked.length >= 4);
  check("la cassa e' analizzata", review.budgetHealth.remaining === 500);
  console.log(
    `       -> migliore: ${review.best?.label} (+${review.best?.surplusPoints.toFixed(2)}), proposta: ${review.suggestion ? review.suggestion.toLabel : "nessuna"}`,
  );

  console.log("\n== 6. Pulizia ==");
  await admin.from("leagues").delete().eq("id", league.id);
  await admin.from("players").delete().eq("season", SEASON);
  const { data: leftovers } = await admin.from("players").select("id").eq("season", SEASON);
  check("dati di prova rimossi", (leftovers?.length ?? 0) === 0);

  console.log(
    failures === 0 ? "\nTUTTI I CONTROLLI SUPERATI\n" : `\n${failures} CONTROLLI FALLITI\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// --- listone sintetico ridotto ---------------------------------------------
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const TEAMS = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"];
const PER_ROLE: Record<Role, number> = { P: 3, D: 8, C: 8, A: 6 };

function makePool(): PlayerWithStats[] {
  seed = 7;
  const out: PlayerWithStats[] = [];
  let id = 0;
  TEAMS.forEach((team, ti) => {
    const strength = 1 - ti / TEAMS.length;
    for (const role of ROLES) {
      for (let i = 0; i < PER_ROLE[role]; i++) {
        id++;
        const depth = 1 - i / PER_ROLE[role];
        const quality = Math.min(1, Math.pow(0.62 * depth + 0.38 * strength, 1.7) * (0.85 + rnd() * 0.3));
        const matches = depth > 0.55 ? Math.round(26 + 10 * quality) : Math.round(3 + 15 * rnd());
        const mv = 5.8 + 0.5 * quality;
        const goals = role === "A" ? Math.round(22 * Math.pow(quality, 1.6)) : role === "C" ? Math.round(11 * Math.pow(quality, 1.9)) : 0;
        const assists = role === "P" ? 0 : Math.round(6 * Math.pow(quality, 1.5));
        const conceded = role === "P" ? Math.round(matches * (1.7 - 0.9 * strength)) : 0;
        const fm = matches > 0 ? mv + (goals * 3 + assists) / matches - (role === "P" ? conceded / matches : 0.1) : mv;
        const quot = Math.max(1, Math.round(1 + Math.pow(quality, 1.4) * (role === "A" ? 20 : role === "C" ? 16 : 11)));
        out.push({
          id: "", season: SEASON, external_id: id, name: `${role}${i + 1} ${team}`, team, role,
          quotation_initial: quot, quotation_current: quot, fvm: quot * 8, is_active: true,
          history: [],
          stats: {
            player_id: "", season: "TEST-2526", matches, minutes: matches * 80,
            avg_vote: Number(mv.toFixed(2)), avg_fantavote: Number(fm.toFixed(2)),
            goals, assists, own_goals: 0, yellow_cards: Math.round(matches * 0.2), red_cards: 0,
            pen_scored: 0, pen_missed: 0, pen_saved: 0, goals_conceded: conceded,
            clean_sheets: role === "P" ? Math.round(matches * 0.25) : 0,
          },
        });
      }
    }
  });
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
