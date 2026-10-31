/**
 * Ricaricare i file ufficiali non deve far perdere niente.
 *
 * Il giorno dell'asta si ricaricano il listone (perche' nel frattempo sono
 * arrivati giocatori nuovi) e le statistiche della stagione in corso. Sono le
 * due operazioni piu' pericolose che questo software fa, perche' toccano le
 * stesse righe su cui negli ultimi giorni si e' accumulato tutto il resto:
 * identita', nomi per esteso, minuti, titolarita', assenze, carriera, e le
 * statistiche recuperate a pagamento dal modello.
 *
 * L'upsert **non tocca le colonne che non manda**, quindi in teoria non si
 * perde niente. Questo controllo lo verifica sul percorso vero — la route, i
 * file veri, il database vero — perche' "in teoria" e' esattamente il posto in
 * cui e' gia' passato un bug arrivato in produzione con tutti i test verdi.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:aggiornamento
 */
import { existsSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];
const STAGIONE = "2026-27";

let failures = 0;
function check(label: string, ok: boolean, dettaglio?: unknown) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`, ok ? "" : (dettaglio ?? ""));
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
  const raw = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64");
  const name = `sb-${REF}-auth-token`;
  const CHUNK = 3180;
  const cookies: string[] = [];
  if (raw.length <= CHUNK) cookies.push(`${name}=${raw}`);
  else
    for (let i = 0, n = 0; i < raw.length; i += CHUNK, n++)
      cookies.push(`${name}.${n}=${raw.slice(i, i + CHUNK)}`);
  return { token: s.access_token as string, cookie: cookies.join("; ") };
}

/** Conta righe con una condizione, senza scaricarle. */
async function conta(token: string, tabella: string, query: string): Promise<number> {
  const res = await fetch(`${SUPA}/rest/v1/${tabella}?select=*&${query}`, {
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const range = res.headers.get("content-range") ?? "";
  return Number(range.split("/")[1] ?? 0);
}

type Foto = Record<string, number>;

async function fotografia(token: string): Promise<Foto> {
  const [
    giocatori,
    attivi,
    identita,
    conNome,
    conAnno,
    assenze,
    carriera,
    conMinuti,
    conTitolarita,
    daModello,
    daArchivio,
    daFile,
    conRigori,
  ] = await Promise.all([
    conta(token, "players", `season=eq.${STAGIONE}`),
    conta(token, "players", `season=eq.${STAGIONE}&is_active=eq.true`),
    conta(token, "player_identities", "player_id=not.is.null"),
    conta(token, "player_identities", "full_name=not.is.null"),
    conta(token, "player_identities", "birth_year=not.is.null"),
    conta(token, "player_absences", "player_id=not.is.null"),
    conta(token, "player_career", "player_id=not.is.null"),
    conta(token, "player_stats", "minutes=not.is.null"),
    conta(token, "player_stats", "lineups=not.is.null"),
    conta(token, "player_stats", "source=eq.ai"),
    conta(token, "player_stats", "source=eq.api"),
    conta(token, "player_stats", "source=eq.import"),
    conta(token, "player_stats", "pen_scored=gt.0"),
  ]);
  return {
    giocatori,
    attivi,
    identita,
    conNome,
    conAnno,
    assenze,
    carriera,
    conMinuti,
    conTitolarita,
    daModello,
    daArchivio,
    daFile,
    conRigori,
  };
}

async function importa(cookie: string, file: string, campi: Record<string, string>) {
  const path = `${process.env.HOME}/Downloads/${file}`;
  if (!existsSync(path)) return { saltato: true as const, file };
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(readFileSync(path))]), file);
  fd.append("season", STAGIONE);
  for (const [k, v] of Object.entries(campi)) fd.append(k, v);
  const res = await fetch(`${BASE}/api/import`, { method: "POST", headers: { cookie }, body: fd });
  const testo = await res.text();
  return { saltato: false as const, file, status: res.status, testo };
}

async function main() {
  const { token, cookie } = await login();

  console.log("\n== Com'e' adesso ==\n");
  const prima = await fotografia(token);
  for (const [k, v] of Object.entries(prima)) console.log(`  ${k.padEnd(16)} ${v}`);

  // Un giocatore preso a caso fra quelli che hanno tutto: se qualcosa si perde,
  // si perde anche a lui, e su un nome solo si vede meglio che su un totale.
  const res = await fetch(
    `${SUPA}/rest/v1/player_identities?select=player_id,full_name,birth_year&full_name=not.is.null&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  const campione = (await res.json())[0] as
    | { player_id: string; full_name: string; birth_year: number | null }
    | undefined;

  console.log("\n== Ricarico i file ufficiali, come faresti tu ==\n");
  const esiti = [
    await importa(cookie, "Quotazioni_Fantacalcio_Stagione_2026_27.xlsx", {
      kind: "quotazioni",
      stats_season: "2025-26",
      competition: "serie-a",
    }),
    await importa(cookie, "Statistiche_Fantacalcio_Stagione_2026_27.xlsx", {
      kind: "statistiche",
      stats_season: STAGIONE,
      competition: "serie-a",
    }),
  ];
  for (const e of esiti) {
    if (e.saltato) {
      console.log(`  (${e.file} non e' in ~/Downloads: saltato)`);
      continue;
    }
    console.log(`  ${e.file} -> http ${e.status}`);
    console.log(`     ${e.testo.slice(0, 220)}`);
    if (e.status !== 200) failures++;
  }

  console.log("\n== Cosa e' cambiato ==\n");
  const dopo = await fotografia(token);
  console.log("  cosa               prima    dopo");
  for (const k of Object.keys(prima)) {
    const segno = dopo[k] === prima[k] ? " " : dopo[k] > prima[k] ? "+" : "-";
    console.log(`  ${k.padEnd(18)} ${String(prima[k]).padStart(5)}   ${String(dopo[k]).padStart(5)} ${segno}`);
  }

  console.log("\n== Quello che non deve sparire ==\n");
  const nonCala = (k: string, nome: string) =>
    check(nome, dopo[k] >= prima[k], `${prima[k]} -> ${dopo[k]}`);
  nonCala("identita", "le identita' restano");
  nonCala("conNome", "i nomi per esteso restano");
  nonCala("conAnno", "gli anni di nascita restano");
  nonCala("assenze", "le assenze restano");
  nonCala("carriera", "la carriera resta");
  nonCala("conMinuti", "i minuti restano");
  nonCala("conTitolarita", "le titolarita' restano");
  nonCala("daModello", "le statistiche recuperate dal modello restano");
  nonCala("daArchivio", "le statistiche dell'archivio restano");
  nonCala("conRigori", "i rigori restano");

  if (campione) {
    const r2 = await fetch(
      `${SUPA}/rest/v1/player_identities?select=full_name,birth_year&player_id=eq.${campione.player_id}`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
    );
    const dopoCampione = (await r2.json())[0] as { full_name: string; birth_year: number | null };
    check(
      `il nome di ${campione.full_name} e' ancora li'`,
      dopoCampione?.full_name === campione.full_name &&
        dopoCampione?.birth_year === campione.birth_year,
      [campione, dopoCampione],
    );
  }

  // Chi e' arrivato e chi se n'e' andato: non e' un errore, ma va saputo.
  if (dopo.giocatori > prima.giocatori) {
    console.log(
      `\n  ${dopo.giocatori - prima.giocatori} giocatori nuovi nel listone: sono al buio ` +
        `(niente identita' ne' storico) finche' non rilanci il recupero.`,
    );
  }
  if (dopo.attivi < prima.attivi) {
    console.log(
      `  ${prima.attivi - dopo.attivi} giocatori non sono piu' nel file: disattivati, ` +
        `ma i loro dati restano dove sono.`,
    );
  }

  console.log(
    failures === 0
      ? "\nRICARICARE I FILE NON PERDE NIENTE\n"
      : `\n${failures} PROBLEMI: NON RICARICARE PRIMA DI AVERLI CAPITI\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
