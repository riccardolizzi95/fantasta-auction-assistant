/**
 * Minuti, rating e partite da titolare per tutto il campionato.
 *
 * I file ufficiali di Fantacalcio.it non hanno nessuno dei tre, su nessuna
 * riga. Sono i campi che distinguono un titolare da una riserva con lo stesso
 * numero di presenze — la differenza che all'asta si paga — e l'archivio li ha.
 *
 * Chiederli un giocatore per volta costerebbe cinquecento chiamate. L'endpoint
 * paginato del campionato ne da' venti a pagina: la Serie A intera sta in una
 * cinquantina, e sulle righe dei file ufficiali non sovrascrive niente — riempie
 * solo le colonne vuote.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:seasons
 *   SEASON=2023 npm run check:seasons
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];
/** Il piano gratuito copre dal 2022 al 2024. 2024 = stagione 2024-25. */
const SEASON = Number(process.env.SEASON || 2024);
const GIRI = Number(process.env.GIRI || 8);
const RESTART = process.env.RESTART === "1";

async function login() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const s = await auth.json();
  if (!auth.ok) throw new Error(`login: ${JSON.stringify(s)}`);
  const raw = "base64-" + Buffer.from(JSON.stringify(s)).toString("base64");
  const name = `sb-${REF}-auth-token`;
  const C = 3180;
  const p: string[] = [];
  if (raw.length <= C) p.push(`${name}=${raw}`);
  else for (let i = 0, k = 0; i < raw.length; i += C, k++) p.push(`${name}.${k}=${raw.slice(i, i + C)}`);
  return p.join("; ");
}

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cookie = await login();
  const stato = await (
    await fetch(`${BASE}/api/season-stats?season=${SEASON}`, { headers: { cookie } })
  ).json();
  console.log(
    `Stagione ${SEASON}-${String((SEASON + 1) % 100).padStart(2, "0")}: ` +
      `${stato.fatte?.length ?? 0} squadre gia' fatte, ` +
      `${stato.quotaOggi}/100 chiamate usate oggi.\n`,
  );

  let calls = 0;
  let nuove = 0;
  let arricchite = 0;
  let riconosciuti = 0;

  for (let giro = 1; giro <= GIRI; giro++) {
    const res = await fetch(`${BASE}/api/season-stats`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ season: SEASON, restart: RESTART && giro === 1 }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);

    if (j.messaggio) {
      console.log(`giro ${giro}: ${j.messaggio}`);
      if (String(j.messaggio).includes("Quota")) break;
      await attendi(62_000);
      continue;
    }

    calls += j.calls ?? 0;
    nuove += j.nuove ?? 0;
    arricchite += j.arricchite ?? 0;
    riconosciuti += j.riconosciuti ?? 0;
    console.log(
      `giro ${giro}: ${j.calls} chiamate · ${j.fatte}/${j.squadre} squadre · ` +
        `${j.riconosciuti} del listone riconosciuti · ${j.nuove} righe nuove · ` +
        `${j.arricchite} arricchite${j.scartate ? ` · ${j.scartate} scartate` : ""}`,
    );
    for (const a of j.avvisi ?? []) console.log(`         ${a}`);
    if (j.stopped) {
      // "Free plans are limited to a maximum value of 3 for the Page
      // parameter" contiene "limited" ma non passa aspettando: e' un limite del
      // piano, non del ritmo. Distinguerli evita cinque giri a vuoto.
      const testo = String(j.stopped);
      const soloRitmo =
        /too many requests|per minute|rate limit/i.test(testo) ||
        (/limit|quota/i.test(testo) && !/free plan/i.test(testo));
      console.log(`         ${soloRitmo ? "in pausa" : "FERMATO"}: ${j.stopped}`);
      if (!soloRitmo) break;
    }
    if (j.done) {
      console.log("         stagione completata.");
      break;
    }
    if (giro < GIRI) {
      console.log("         attendo il minuto...");
      await attendi(62_000);
    }
  }

  console.log(
    `\n${calls} pagine lette · ${riconosciuti} giocatori del listone riconosciuti · ` +
      `${nuove} righe nuove · ${arricchite} righe arricchite con minuti, rating e titolarita'.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Senza un export questo file starebbe nello scope globale.
export {};
