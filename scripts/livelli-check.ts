/**
 * I prezzi si calcolano sul server, e a chi non ha il premium non arrivano.
 *
 * Sono due promesse diverse e questo controllo le tiene separate.
 *
 * La prima e' una **garanzia di non-regressione**: spostare il conto dal
 * browser al server non deve aver cambiato un solo prezzo. Si confrontano i
 * numeri che l'endpoint vero restituisce con quelli che `buildValuations`
 * produce qui, sugli stessi ingredienti, giocatore per giocatore.
 *
 * La seconda e' il muro: un account base chiama lo stesso endpoint e deve
 * ricevere `null`. Non un elenco filtrato, non zeri — niente, perche' il conto
 * per lui non viene proprio fatto.
 *
 * Chiama l'endpoint reale, non una sua copia: e' la lezione che questo progetto
 * ha gia' pagato una volta.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   BASE_URL=http://localhost:3000 TEST_EMAIL=... TEST_PASSWORD=... npm run check:livelli
 */
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";

// Node 20 non ha WebSocket nativo: serve al client Supabase.
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;
import { buildValuations, type Valuation } from "../src/lib/fanta/valuation";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLES,
  type PlayerWithStats,
  type Role,
} from "../src/lib/fanta/types";

const URL_SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_EMAIL = process.env.TEST_EMAIL!;
const ADMIN_PASSWORD = process.env.TEST_PASSWORD!;
const SEASON = "TEST-LIV";
const RIF = URL_SUPA.replace("https://", "").split(".")[0];

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

const anon = () => createClient(URL_SUPA, KEY, { auth: { persistSession: false } });

/**
 * Il cookie di sessione come lo scrive `@supabase/ssr`.
 *
 * Serve perche' l'endpoint si chiama come lo chiama il browser, non con un
 * Bearer: e' il percorso vero, e con un percorso finto un bug e' gia' arrivato
 * in produzione una volta.
 */
function cookieDiSessione(sessione: unknown): string {
  const valore = "base64-" + Buffer.from(JSON.stringify(sessione)).toString("base64");
  const pezzi: string[] = [];
  for (let i = 0; i < valore.length; i += 3180) pezzi.push(valore.slice(i, i + 3180));
  return pezzi
    .map((p, i) => `sb-${RIF}-auth-token${pezzi.length > 1 ? "." + i : ""}=${p}`)
    .join("; ");
}

async function chiediValutazioni(cookie: string, legaId: string) {
  const res = await fetch(`${BASE}/api/lega/${legaId}/valutazioni`, { headers: { cookie } });
  return { stato: res.status, corpo: await res.json() };
}

async function main() {
  const admin = anon();
  const { data: auth, error: authErr } = await admin.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (!auth?.user) {
    console.log("  FAIL login amministratore", authErr?.message);
    process.exit(1);
  }
  const adminId = auth.user.id;

  console.log("\n== 1. Un listone di prova e una lega ==");
  await admin.from("players").delete().eq("season", SEASON);
  const pool = makePool();
  const { error: pErr } = await admin.from("players").insert(
    pool.map((p) => ({
      season: SEASON,
      external_id: p.external_id,
      name: p.name,
      team: p.team,
      role: p.role,
      quotation_initial: p.quotation_initial,
      quotation_current: p.quotation_current,
      fvm: p.fvm,
      is_active: true,
    })),
  );
  check("listone inserito", !pErr, pErr?.message);

  const { data: righe } = await admin
    .from("players")
    .select("id, external_id")
    .eq("season", SEASON);
  const idPerExternal = new Map((righe ?? []).map((r) => [r.external_id, r.id]));
  const statRows = pool.flatMap((p) =>
    (p.history ?? []).map((h) => ({ ...h, player_id: idPerExternal.get(p.external_id)! })),
  );
  const { error: sErr } = await admin.from("player_stats").insert(statRows);
  check("statistiche inserite", !sErr, sErr?.message);

  const { data: lega, error: lErr } = await admin
    .from("leagues")
    .insert({
      name: "Lega livelli",
      owner_id: adminId,
      season: SEASON,
      budget: 500,
      n_participants: 8,
      slots: DEFAULT_SLOTS,
      rules: { ...DEFAULT_RULES, defense_modifier: true },
    })
    .select("*")
    .single();
  check("lega creata", !lErr && !!lega, lErr?.message);
  if (!lega) return pulisci(admin, lega);

  const rivali = ["Marco", "Luca", "Giulia", "Andrea", "Sara", "Paolo", "Elena"];
  await admin
    .from("participants")
    .insert(rivali.map((name) => ({ league_id: lega.id, name, budget_total: 500 })));

  console.log("\n== 2. Il premium riceve i prezzi, e sono gli stessi di prima ==");
  const cookieAdmin = cookieDiSessione(auth.session);
  const { stato, corpo } = await chiediValutazioni(cookieAdmin, lega.id);
  check("l'endpoint risponde", stato === 200, `${stato} ${JSON.stringify(corpo).slice(0, 200)}`);
  const dalServer: Valuation[] = corpo?.valutazioni?.perGiocatore ?? [];
  check("arrivano tutte le valutazioni", dalServer.length === pool.length, dalServer.length);

  // Gli stessi ingredienti che usa il server: otto squadre dichiarate, otto
  // iscritte, cinquecento crediti a testa.
  const { data: parts } = await admin.from("participants").select("*").eq("league_id", lega.id);
  const listone = await rileggiListone(admin, lega.season);
  const locali = buildValuations(listone, {
    season: lega.season,
    nParticipants: Math.max((parts ?? []).length, lega.n_participants),
    budget: Math.round(
      (parts ?? []).reduce((a, p) => a + p.budget_total, 0) / Math.max(1, (parts ?? []).length),
    ),
    slots: lega.slots,
    rules: lega.rules,
    topPrices: lega.top_prices ?? undefined,
  });

  let diversi = 0;
  let peggiore = 0;
  for (const v of dalServer) {
    const mio = locali.byPlayer.get(v.playerId);
    if (!mio) {
      diversi++;
      continue;
    }
    const scarto = Math.abs(mio.baseValue - v.baseValue);
    if (scarto > peggiore) peggiore = scarto;
    if (scarto > 0.001 || mio.tier !== v.tier || mio.rankInRole !== v.rankInRole) diversi++;
  }
  console.log(
    `  ${dalServer.length} valutazioni confrontate, scarto massimo sul prezzo ${peggiore.toFixed(6)}`,
  );
  // La promessa non e' "quasi uguali": e' che spostare il conto non ha cambiato
  // niente. Un solo giocatore diverso qui vuol dire che il server e il browser
  // stavano usando ingredienti diversi.
  check("spostare il conto sul server non ha cambiato un prezzo", diversi === 0, `${diversi} diversi`);

  console.log("\n== 3. Il base non li riceve affatto ==");
  const emailBase = `base-${Date.now()}@fantasta.local`;
  const { error: cErr } = await admin.rpc("admin_create_user", {
    p_email: emailBase,
    p_password: "provapassword123",
    p_display_name: "Utente base",
    p_is_admin: false,
    p_is_premium: false,
  });
  check("account base creato", !cErr, cErr?.message);

  const ospite = anon();
  const { data: authBase, error: abErr } = await ospite.auth.signInWithPassword({
    email: emailBase,
    password: "provapassword123",
  });
  check("login del base", !abErr && !!authBase?.user, abErr?.message);
  if (!authBase?.session) return pulisci(admin, lega, emailBase);

  const { error: jErr } = await ospite.rpc("join_league", { p_code: lega.invite_code });
  check("il base entra nella lega", !jErr, jErr?.message);

  const cookieBase = cookieDiSessione(authBase.session);
  const risBase = await chiediValutazioni(cookieBase, lega.id);
  check("l'endpoint risponde anche a lui", risBase.stato === 200, risBase.stato);
  check("ma il livello e' base", risBase.corpo?.livello === "base", risBase.corpo?.livello);
  // Non un elenco vuoto, non degli zeri: null. Il conto non e' stato fatto.
  check(
    "e le valutazioni sono null, non filtrate",
    risBase.corpo?.valutazioni === null,
    JSON.stringify(risBase.corpo).slice(0, 200),
  );
  check(
    "nella risposta non c'e' nessun prezzo",
    !JSON.stringify(risBase.corpo).includes("baseValue"),
    JSON.stringify(risBase.corpo).slice(0, 200),
  );

  console.log("\n== 4. Chi non e' nella lega non passa ==");
  const estraneo = `estraneo-${Date.now()}@fantasta.local`;
  await admin.rpc("admin_create_user", {
    p_email: estraneo,
    p_password: "provapassword123",
    p_display_name: "Estraneo",
    p_is_admin: false,
    p_is_premium: true,
  });
  const fuori = anon();
  const { data: authFuori } = await fuori.auth.signInWithPassword({
    email: estraneo,
    password: "provapassword123",
  });
  if (authFuori?.session) {
    const ris = await chiediValutazioni(cookieDiSessione(authFuori.session), lega.id);
    check("un premium di un'altra lega non vede questi prezzi", ris.stato === 404, ris.stato);
  }

  await pulisci(admin, lega, emailBase, estraneo);
  console.log(failures === 0 ? "\nIL MURO TIENE\n" : `\n${failures} PROBLEMI\n`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Rilegge il listone come fa il server, con tutto lo storico attaccato. */
async function rileggiListone(
  client: ReturnType<typeof anon>,
  season: string,
): Promise<PlayerWithStats[]> {
  const { data } = await client
    .from("players")
    .select(
      "id, season, external_id, name, team, role, quotation_initial, quotation_current, fvm, is_active," +
        " player_stats(season, competition, source, source_detail, rating, matches, minutes, avg_vote," +
        " avg_fantavote, goals, assists, own_goals, yellow_cards, red_cards, pen_scored, pen_missed," +
        " pen_saved, goals_conceded, clean_sheets)",
    )
    .eq("season", season)
    .eq("is_active", true)
    .order("name");
  return (data ?? []).map((row) => {
    const raw = row as unknown as Record<string, unknown> & { player_stats: unknown[] };
    const { player_stats, ...rest } = raw;
    const history = (player_stats ?? [])
      .filter(Boolean)
      .slice()
      .sort((a, b) =>
        (a as { season: string }).season < (b as { season: string }).season ? 1 : -1,
      ) as PlayerWithStats["history"];
    return {
      ...(rest as unknown as PlayerWithStats),
      stats: history?.[0] ?? null,
      history,
    } as PlayerWithStats;
  });
}

async function pulisci(
  client: ReturnType<typeof anon>,
  lega?: { id: string } | null,
  ...email: string[]
) {
  if (lega) await client.from("leagues").delete().eq("id", lega.id);
  await client.from("players").delete().eq("season", SEASON);
  if (email.length === 0) return;
  // Un account di prova lasciato in giro non e' un file di scarto: e' una
  // credenziale che resta valida. Si cancella qui, non "poi".
  const { data } = await client.rpc("admin_list_users");
  for (const e of email) {
    const u = (data ?? []).find((x: { email: string }) => x.email === e);
    if (!u) continue;
    const { error } = await client.rpc("admin_delete_user", { p_user_id: u.id });
    if (error) console.log(`  ATTENZIONE: account ${e} non cancellato — ${error.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

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

export {};
