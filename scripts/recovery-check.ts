/**
 * Quanto dura un lotto di recupero, e quanti giocatori risolve davvero.
 *
 * Serve a fissare la dimensione del lotto con una misura invece che a occhio:
 * su Vercel Hobby la funzione viene troncata a 60 secondi qualunque cosa dica
 * `maxDuration`, e un lotto troncato non scrive niente perche' l'inserimento
 * avviene in fondo. Il numero che conta e' quindi la durata del lotto piu'
 * lento, non quella media.
 *
 * Chiama l'endpoint vero con la sessione vera: un percorso riscritto qui
 * misurerebbe la velocita' di questo script, non quella dell'applicazione.
 *
 * Guida il ciclo vero: gli stessi POST che fa il browser, sullo stesso endpoint,
 * con la stessa sessione. Un ciclo riscritto qui misurerebbe la velocita' di
 * questo script, non quella dell'applicazione.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:recovery
 *   TAKE=20 LOTTI=2 npm run check:recovery
 *   LOTTI=99 npm run check:recovery              # fino in fondo, si paga tutto
 *   BASE_URL=http://localhost:3000 npm run check:recovery
 */
import { toRecover, quotationOf } from "../src/lib/fanta/recovery";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];
const TAKE = Number(process.env.TAKE || 20);
/** Quanti lotti prima di fermarsi. Basso di proposito: ogni lotto si paga. */
const LOTTI = Number(process.env.LOTTI || 2);
const SOURCE = process.env.SOURCE || "auto";
const SEASON = process.env.SEASON || "2026-27";
const WEB = process.env.WEB !== "false";

/** Costo misurato, per giocatore, con ricerca web. Vedi DATI.md. */
const COSTO_AI_PER_GIOCATORE = 0.0087;

/** Il tetto vero della funzione su Vercel Hobby, qualunque cosa dica maxDuration. */
const LIMITE_FUNZIONE_MS = 60_000;

type Outcome = { playerId: string; name: string; status: string; via?: string | null };

async function login() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const session = await auth.json();
  if (!auth.ok) throw new Error(`login: ${JSON.stringify(session)}`);

  // @supabase/ssr conserva la sessione in un cookie base64 spezzato in blocchi.
  const raw = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const name = `sb-${REF}-auth-token`;
  const CHUNK = 3180;
  const parts: string[] = [];
  if (raw.length <= CHUNK) parts.push(`${name}=${raw}`);
  else
    for (let i = 0, k = 0; i < raw.length; i += CHUNK, k++)
      parts.push(`${name}.${k}=${raw.slice(i, i + CHUNK)}`);
  return { cookie: parts.join("; "), token: session.access_token as string };
}

/**
 * Tutte le righe di una tabella, a pagine.
 *
 * PostgREST ne restituisce mille per volta e non lo dice: la prima versione di
 * questo script contava 209 giocatori da recuperare invece di 151, perche' le
 * 621 righe di statistiche oltre la millesima non arrivavano e i loro giocatori
 * sembravano senza storico.
 */
async function loadAll<T>(url: string, headers: Record<string, string>): Promise<T[]> {
  const PAGINA = 1000;
  const out: T[] = [];
  for (let da = 0; ; da += PAGINA) {
    const res = await fetch(url, {
      headers: { ...headers, Range: `${da}-${da + PAGINA - 1}`, "Range-Unit": "items" },
    });
    const chunk = await res.json();
    if (!Array.isArray(chunk)) throw new Error(`${url}: ${JSON.stringify(chunk)}`);
    out.push(...(chunk as T[]));
    if (chunk.length < PAGINA) return out;
  }
}

/** Il listone come lo vede l'applicazione: stesse policy, stesse colonne. */
async function loadPlayers(token: string) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}` };
  const [players, stats] = await Promise.all([
    loadAll<Record<string, unknown>>(
      `${SUPA}/rest/v1/players?select=id,name,team,role,quotation_current,fvm&is_active=eq.true`,
      headers,
    ),
    loadAll<{ player_id: string; season: string; competition: string | null; matches: number }>(
      `${SUPA}/rest/v1/player_stats?select=player_id,season,competition,matches`,
      headers,
    ),
  ]);
  const byPlayer = new Map<string, typeof stats>();
  for (const s of stats) {
    const list = byPlayer.get(s.player_id) ?? [];
    list.push(s);
    byPlayer.set(s.player_id, list);
  }
  return players.map((p) => ({
    ...(p as { id: string; name: string; team: string; role: "P" | "D" | "C" | "A" }),
    quotation_current: p.quotation_current as number | null,
    fvm: p.fvm as number | null,
    history: byPlayer.get(p.id as string) ?? [],
  }));
}

/**
 * Un lotto, chiesto come lo chiede il browser: e' il server a scegliere su chi
 * lavorare. Passare qui un elenco di id vorrebbe dire misurare una selezione che
 * in produzione non gira.
 */
async function runBatch(cookie: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/external-stats`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ take: TAKE, source: SOURCE, web: WEB }),
  });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => ({ error: "risposta illeggibile" }));
  return { ms, ok: res.ok, status: res.status, json };
}

async function usage(cookie: string) {
  const res = await fetch(`${BASE}/api/usage`, { headers: { cookie } });
  if (!res.ok) return "non leggibile";
  const j = await res.json();
  const f = j.football;
  return f?.ok
    ? `API-Football ${f.used}/${f.limit} usate oggi, ${f.remaining} rimaste`
    : `API-Football: ${f?.message ?? "sconosciuto"}`;
}

async function main() {
  const { cookie, token } = await login();
  const players = await loadPlayers(token);
  const coda = toRecover(players, SEASON);

  console.log(`Listone: ${players.length} attivi, ${coda.length} ancora senza dati.`);
  console.log(`Quota all'inizio: ${await usage(cookie)}.`);
  console.log(
    `Piu' quotato in coda: ${coda[0]?.name ?? "—"} (${quotationOf(coda[0] ?? ({} as never))}), ` +
      `mediana ${quotationOf(coda[Math.floor(coda.length / 2)] ?? ({} as never))}.`,
  );
  const daLavorare = Math.min(coda.length, TAKE * LOTTI);
  console.log(
    `Spesa prevista: fino a ~$${(daLavorare * COSTO_AI_PER_GIOCATORE).toFixed(2)} ` +
      `(${LOTTI} lotti da ${TAKE}, ricerca web ${WEB ? "attiva" : "spenta"}).\n`,
  );

  const durate: number[] = [];
  let costo = 0;
  let risoltiTotali = 0;
  let lotti = 0;

  for (let k = 1; k <= LOTTI; k++) {
    const { ms, ok, status, json } = await runBatch(cookie);
    lotti = k;
    durate.push(ms);
    if (!ok) {
      console.log(`lotto ${k}: ✗ HTTP ${status} dopo ${(ms / 1000).toFixed(1)}s — ${json.error ?? ""}`);
      break;
    }
    costo += Number(json.cost ?? 0);
    risoltiTotali += Number(json.resolved ?? 0);
    const outcomes = (json.outcomes ?? []) as Outcome[];
    const viaApi = outcomes.filter((o) => o.via === "api").length;
    const viaAi = outcomes.filter((o) => o.via === "ai").length;

    console.log(
      `lotto ${k}: ${(ms / 1000).toFixed(1)}s · ${json.processed} lavorati, ` +
        `${json.resolved} risolti (api ${viaApi}, ai ${viaAi}) · ${json.written} stagioni · ` +
        `${json.apiCalls} chiamate archivio (${json.apiCallsToday} oggi)` +
        (json.cost != null ? ` · $${Number(json.cost).toFixed(4)}` : "") +
        ` · ne restano ${json.remaining}`,
    );
    if (json.years?.length) console.log(`         annate chieste: ${json.years.join(", ")}`);
    if (json.emptySeasons?.length)
      console.log(`         annate che l'archivio non serve: ${json.emptySeasons.join(", ")}`);
    if (json.skipped) console.log(`         ${json.skipped} scartate: esiste il dato ufficiale`);
    if (json.stopped) console.log(`         FERMATO: ${json.stopped}`);
    for (const a of json.avvisi ?? []) console.log(`         avviso: ${a}`);
    for (const o of outcomes) {
      console.log(`         ${String(o.status).padEnd(14)} ${o.name}${o.via ? ` (${o.via})` : ""}`);
    }

    if (json.done) {
      console.log("         coda finita.");
      break;
    }
    if (!json.processed) {
      console.log("         nessuno lavorabile: il ciclo si fermerebbe qui.");
      break;
    }
  }

  const max = Math.max(...durate, 0);
  console.log(`\nQuota alla fine: ${await usage(cookie)}.`);
  console.log(
    `\n${lotti} lotti · ${risoltiTotali} giocatori risolti · $${costo.toFixed(3)} · ` +
      `lotto piu' lento ${(max / 1000).toFixed(1)}s su ${LIMITE_FUNZIONE_MS / 1000}s disponibili ` +
      `(${((max / LIMITE_FUNZIONE_MS) * 100).toFixed(0)}% del tetto).`,
  );
  if (max > LIMITE_FUNZIONE_MS * 0.75) {
    console.log("Il lotto e' troppo grande: abbassare LOTTO_DEFAULT nella route.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
