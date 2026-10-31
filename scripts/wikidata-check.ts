/**
 * Quanto del listone copre Wikidata, e con quale filtro.
 *
 * Wikidata non costa niente, quindi la domanda non e' "conviene?" ma "quanto
 * riusciamo a prenderne". La risposta dipende quasi tutta da una scelta: come si
 * riconosce un tesseramento **ancora valido**. "Senza data di fine" non basta —
 * molte voci vecchie non l'hanno mai avuta, e la prima versione restituiva un
 * giocatore nato nel 1919. Ma pretendere anche la data d'inizio taglia da 2621
 * a 776 tesseramenti, e con essi i giocatori che ci servono.
 *
 * Questo script prova le varianti sul listone vero e conta chi trova, su chi
 * resta ambiguo e chi non trova. Non scrive niente.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:wikidata
 */
import { abbinaRosa, stessaSquadra } from "../src/lib/fanta/rosters";
import { toRecover } from "../src/lib/fanta/recovery";
import {
  parseRoster,
  soloClubPiuRecente,
  WIKIDATA_ENDPOINT,
  WIKIDATA_UA,
} from "../src/lib/fanta/wikidata";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Le varianti. Cambia solo la clausola che decide "e' ancora in rosa": tutto il
 * resto e' identico, altrimenti si misurerebbe qualcos'altro.
 */
const VARIANTI: { nome: string; where: string }[] = [
  {
    nome: "senza fine + inizio dal 2019 (in uso)",
    where: `?st pq:P580 ?start .
  FILTER NOT EXISTS { ?st pq:P582 ?e }
  FILTER(?start >= "2019-01-01"^^xsd:dateTime)`,
  },
  {
    nome: "senza fine, inizio facoltativo, nato dal 1993",
    where: `FILTER NOT EXISTS { ?st pq:P582 ?e }
  ?player wdt:P569 ?dob . FILTER(YEAR(?dob) >= 1993)
  OPTIONAL { ?st pq:P580 ?start }`,
  },
  {
    nome: "nato dal 1993, anche con data di fine",
    where: `?player wdt:P569 ?dob . FILTER(YEAR(?dob) >= 1993)
  OPTIONAL { ?st pq:P580 ?start }`,
  },
  {
    nome: "senza fine oppure iniziato dal 2024, nato dal 1993",
    where: `?player wdt:P569 ?dob . FILTER(YEAR(?dob) >= 1993)
  OPTIONAL { ?st pq:P580 ?start }
  FILTER(NOT EXISTS { ?st pq:P582 ?e } || ?start >= "2024-01-01"^^xsd:dateTime)`,
  },
];

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

async function listone(token: string) {
  const res = await fetch(
    `${SUPA}/rest/v1/players?select=id,name,team,season,quotation_current,fvm,` +
      `player_stats(season,competition,matches)&is_active=eq.true`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(JSON.stringify(data));
  type Riga = {
    id: string;
    name: string;
    team: string;
    season: string;
    quotation_current: number | null;
    fvm: number | null;
    player_stats: { season: string; competition: string | null; matches: number }[] | null;
  };
  return (data as Riga[]).map((p) => ({ ...p, history: p.player_stats ?? [] }));
}

async function chiedi(where: string) {
  const q = `SELECT ?clubLabel ?player ?playerLabel ?dob ?natLabel ?start WHERE {
  ?club wdt:P118 wd:Q15804 .
  ?player p:P54 ?st . ?st ps:P54 ?club .
  ${where}
  OPTIONAL { ?player wdt:P27 ?nat }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
}`;
  const res = await fetch(`${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(q)}`, {
    headers: { Accept: "application/sparql-results+json", "User-Agent": WIKIDATA_UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return soloClubPiuRecente(parseRoster(await res.json()));
}

async function main() {
  const rosa = await listone(await login());
  const squadre = [...new Set(rosa.map((p) => p.team))];
  // Il numero che conta non e' su tutto il listone: chi ha gia' lo storico di
  // Serie A non ha bisogno di essere identificato da nessuno. La copertura utile
  // e' quella sulla coda del recupero.
  const coda = new Set(toRecover(rosa, rosa[0]?.season ?? "").map((p) => p.id));
  console.log(
    `Listone: ${rosa.length} giocatori, ${squadre.length} squadre. ` +
      `Da identificare davvero: ${coda.size}.\n`,
  );

  for (const v of VARIANTI) {
    const t0 = Date.now();
    let voci: Awaited<ReturnType<typeof chiedi>>;
    try {
      voci = await chiedi(v.where);
    } catch (e) {
      console.log(`${v.nome.padEnd(50)} FALLITA: ${(e as Error).message}`);
      continue;
    }
    let trovati = 0;
    let ambigui = 0;
    let trovatiInCoda = 0;
    const esempi: string[] = [];
    for (const squadra of squadre) {
      const suoi = voci.filter((x) => stessaSquadra(squadra, x.club));
      const e = abbinaRosa(
        rosa.filter((p) => p.team === squadra),
        suoi.map((x) => ({ id: x.qid, name: x.fullName })),
      );
      trovati += e.trovati.length;
      trovatiInCoda += e.trovati.filter((t) => coda.has(t.playerId)).length;
      ambigui += e.ambigui.length;
      if (esempi.length < 3 && e.ambigui[0]) {
        esempi.push(`${e.ambigui[0].listone} -> ${e.ambigui[0].candidati.slice(0, 2).join(" / ")}`);
      }
    }
    console.log(
      `${v.nome.padEnd(50)} ${String(voci.length).padStart(5)} voci · ` +
        `tutto il listone ${String(trovati).padStart(3)}/${rosa.length} · ` +
        `DA IDENTIFICARE ${String(trovatiInCoda).padStart(3)}/${coda.size} · ` +
        `ambigui ${ambigui} · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    if (esempi.length) console.log(`      esempi di ambiguita': ${esempi.join(" | ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
