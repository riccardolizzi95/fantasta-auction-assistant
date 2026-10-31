/**
 * Riempie l'identita' di tutto il listone dalle rose ufficiali.
 *
 * Venti chiamate all'archivio sportivo — una per squadra — contro le circa
 * centocinquanta che costava chiederlo al modello, e senza inventare niente:
 * il listone dice "Ramos G." e dice la squadra, e dentro una rosa di
 * venticinque nomi un cognome piu' l'iniziale identifica una persona sola.
 *
 * Il piano gratuito accetta dieci chiamate al minuto, quindi la spazzata va in
 * tre giri con un minuto di attesa in mezzo. Lo stato sta sul database: se si
 * interrompe, riprende dalle squadre che mancano.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:rosters
 *   RESTART=1 npm run check:rosters     # ricomincia da capo
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];
const RESTART = process.env.RESTART === "1";
/** "auto" fa Wikidata e poi l'archivio; "wikidata" solo la parte gratuita. */
const FONTE = process.env.FONTE || "auto";
/** Quanti giri al massimo. Venti squadre a nove chiamate stanno in tre. */
const GIRI = Number(process.env.GIRI || 6);

async function login() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const session = await auth.json();
  if (!auth.ok) throw new Error(`login: ${JSON.stringify(session)}`);
  const raw = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const name = `sb-${REF}-auth-token`;
  const CHUNK = 3180;
  const parts: string[] = [];
  if (raw.length <= CHUNK) parts.push(`${name}=${raw}`);
  else
    for (let i = 0, k = 0; i < raw.length; i += CHUNK, k++)
      parts.push(`${name}.${k}=${raw.slice(i, i + CHUNK)}`);
  return parts.join("; ");
}

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cookie = await login();

  const stato = await (await fetch(`${BASE}/api/rosters`, { headers: { cookie } })).json();
  console.log(
    `Partenza: ${stato.fatte}/${stato.squadre || "?"} squadre gia' spazzate, ` +
      `${stato.quotaOggi}/100 chiamate usate oggi.\n`,
  );

  const ambigui: { listone: string; candidati: string[] }[] = [];
  const mancanti: string[] = [];
  let abbinati = 0;
  let conNome = 0;
  let calls = 0;
  let daWikidata = 0;

  for (let giro = 1; giro <= GIRI; giro++) {
    const res = await fetch(`${BASE}/api/rosters`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ restart: RESTART && giro === 1, source: FONTE }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);

    if (j.daWikidata) {
      daWikidata += j.daWikidata;
      console.log(`giro ${giro}: Wikidata ha scritto ${j.daWikidata} identita' (gratis)`);
    }
    for (const a of j.avvisi ?? []) console.log(`         ${a}`);
    if (j.messaggio) {
      console.log(`giro ${giro}: ${j.messaggio}`);
      if (String(j.messaggio).includes("Quota")) break;
      await attendi(62_000);
      continue;
    }

    calls += j.calls ?? 0;
    abbinati += j.abbinati ?? 0;
    conNome += j.conNomeIntero ?? 0;
    ambigui.push(...(j.ambigui ?? []));
    mancanti.push(...(j.mancanti ?? []));

    if (j.calls > 0 || j.squadre > 0) {
      console.log(
        `giro ${giro}: ${j.calls} chiamate · ${j.fatte}/${j.squadre} squadre · ` +
          `${j.abbinati ?? 0} abbinati (${j.conNomeIntero ?? 0} col nome intero) · ` +
          `ne restano ${j.restanti ?? 0}`,
      );
    }
    // Un errore che non e' il limite al minuto non si risolve aspettando: la
    // prima versione ha ripetuto cinque volte la stessa chiamata rifiutata,
    // spendendo cinque chiamate per riavere cinque volte lo stesso messaggio.
    const soloRitmo = /limit|quota|rate/i.test(String(j.stopped ?? ""));
    if (j.stopped && !soloRitmo) {
      console.log(`giro ${giro}: FERMATO — ${j.stopped}`);
      break;
    }
    if (j.stopped) console.log(`         FERMATO: ${j.stopped}`);
    if (j.done) break;
    if (giro < GIRI) {
      console.log("         attendo il minuto...");
      await attendi(62_000);
    }
  }

  if (daWikidata > 0) {
    console.log(`\n${daWikidata} identita' da Wikidata, senza spendere una chiamata.`);
  }
  if (calls > 0) {
    console.log(`${abbinati} giocatori abbinati dall'archivio con ${calls} chiamate.`);
    console.log(
      `Di questi, ${conNome} con il nome per esteso; per gli altri l'archivio ` +
        `abbrevia e il nome resta quello che c'era.`,
    );
  }

  if (ambigui.length > 0) {
    console.log(`\n${ambigui.length} ambigui — due candidati con lo stesso cognome e iniziale:`);
    for (const a of ambigui) console.log(`  ${a.listone}: ${a.candidati.join(" / ")}`);
  }
  if (mancanti.length > 0) {
    console.log(`\n${mancanti.length} non trovati nella rosa ufficiale:`);
    console.log(`  ${mancanti.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Senza un export questo file starebbe nello scope globale, e due script che
// dichiarano la stessa costante non compilerebbero insieme.
export {};
