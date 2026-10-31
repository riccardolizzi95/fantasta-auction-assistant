/**
 * La carriera presa dai fatti, non dalla memoria di un modello.
 *
 * Il pezzo di archivio piu' fragile che avessimo era proprio quello che serve
 * di piu': **chi arriva da fuori**. Per un giocatore senza storico in Serie A
 * la carriera la scriveva un modello linguistico a memoria, e misurato su un
 * caso qualsiasi — Alhassane del Bologna — diceva: 2025-26 Bologna Serie A,
 * 2023-24 Bologna U19. Nessuna delle due e' vera: quell'anno era al Real Oviedo
 * in Segunda, e nelle giovanili stava in Spagna. Un modello che non sa risponde
 * lo stesso, e risponde con la cosa piu' probabile — il club che gli hai appena
 * nominato.
 *
 * Wikidata invece non stima: cita. Ogni tesseramento e' una dichiarazione con
 * club, date, **se era un prestito**, e spesso presenze e gol; e il club porta
 * con se' il campionato e il paese, che e' esattamente cio' che serve al
 * convertitore. Costa zero, non ha chiave e non ha quota, e una sola query
 * copre tutto il listone.
 *
 * Quello che Wikidata non ha e' l'aggiornamento dell'ultimo mercato: chi si e'
 * mosso a luglio spesso non c'e' ancora. Per questo non sostituisce le altre
 * fonti, le **precede**: riempie il passato con dei fatti, e lascia al resto
 * della catena il presente.
 */
import { resolveCompetition } from "./competitions";
import { WIKIDATA_ENDPOINT, WIKIDATA_UA } from "./wikidata";

/** Una stagione va da luglio a giugno: "2024-25" comincia a luglio 2024. */
export const INIZIO_STAGIONE_MESE = 7;

export type TappaWikidata = {
  qid: string;
  club: string;
  /** Il campionato del club, come lo chiama Wikidata ("Ligue 1"). */
  lega: string | null;
  paese: string | null;
  /** Estremi del tesseramento, se dichiarati. */
  dal: string | null;
  al: string | null;
  prestito: boolean;
  partite: number | null;
  gol: number | null;
};

const escape = (s: string) => s.replace(/["\\]/g, "").trim();

/**
 * I QID a partire dai nomi.
 *
 * Si passa dall'etichetta esatta e non da una ricerca: `rdfs:label` e' indicizzato
 * e risponde in un decimo di secondo, mentre un confronto con `FILTER(STR(...))`
 * su tutti i calciatori del mondo fa cadere la connessione — misurato, cadeva.
 * Si provano l'italiano e l'inglese perche' meta' dei calciatori stranieri hanno
 * la voce solo in una delle due.
 */
export function qidQuery(nomi: string[]): string {
  const values = nomi
    .map(escape)
    .filter(Boolean)
    .flatMap((n) => [`"${n}"@it`, `"${n}"@en`])
    .join(" ");
  return `SELECT ?nome ?player WHERE {
  VALUES ?nome { ${values} }
  ?player rdfs:label ?nome .
  ?player wdt:P106 wd:Q937857 .
} LIMIT 2000`;
}

/** Da nome (come l'abbiamo chiesto) a QID. Il primo che risponde vince. */
export function parseQid(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const b = (json as { results?: { bindings?: Record<string, { value: string }>[] } })?.results?.bindings ?? [];
  for (const riga of b) {
    const nome = riga.nome?.value;
    const qid = riga.player?.value?.split("/").pop();
    if (!nome || !qid || out.has(nome)) continue;
    out.set(nome, qid);
  }
  return out;
}

/**
 * Tutti i tesseramenti di un gruppo di giocatori, in una query sola.
 *
 * Le nazionali si scartano qui e non dopo: `P54` le comprende, e una riga
 * "nazionale del Niger, 30 presenze" in mezzo alla carriera di club confonde
 * chiunque la legga.
 */
export function carrieraQuery(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `SELECT ?player ?clubLabel ?legaLabel ?paeseLabel ?start ?end ?prestito ?partite ?gol WHERE {
  VALUES ?player { ${values} }
  ?player p:P54 ?st . ?st ps:P54 ?club .
  FILTER NOT EXISTS { ?club wdt:P31/wdt:P279* wd:Q6979593 }
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P1642 ?prestito }
  OPTIONAL { ?st pq:P1350 ?partite }
  OPTIONAL { ?st pq:P1351 ?gol }
  OPTIONAL { ?club wdt:P118 ?lega . OPTIONAL { ?lega wdt:P17 ?paese } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
}`;
}

export function parseCarriera(json: unknown): TappaWikidata[] {
  const b = (json as { results?: { bindings?: Record<string, { value: string }>[] } })?.results?.bindings ?? [];
  const out: TappaWikidata[] = [];
  for (const r of b) {
    const qid = r.player?.value?.split("/").pop();
    const club = r.clubLabel?.value;
    if (!qid || !club) continue;
    const numero = (v?: { value: string }) => (v ? Number(v.value) : null);
    out.push({
      qid,
      club,
      lega: r.legaLabel?.value ?? null,
      paese: r.paeseLabel?.value ?? null,
      dal: r.start?.value ?? null,
      al: r.end?.value ?? null,
      prestito: Boolean(r.prestito),
      partite: numero(r.partite),
      gol: numero(r.gol),
    });
  }
  return out;
}

/** L'etichetta della stagione che comincia in quell'anno: 2024 -> "2024-25". */
export const etichettaStagione = (anno: number) =>
  `${anno}-${String((anno + 1) % 100).padStart(2, "0")}`;

/** In che stagione cade una data: luglio 2025 sta in 2025-26, marzo 2025 in 2024-25. */
export function stagioneDiData(iso: string): number {
  const d = new Date(iso);
  return d.getUTCMonth() + 1 >= INIZIO_STAGIONE_MESE ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/**
 * Le stagioni coperte da un tesseramento.
 *
 * Un tesseramento senza data di fine e' ancora aperto: arriva fino alla
 * stagione in corso. Uno senza nemmeno la data d'inizio non si puo' collocare,
 * e allora non si colloca — meglio una stagione senza riga che una riga
 * inventata.
 */
export function stagioniDi(t: TappaWikidata, stagioneCorrente: number): number[] {
  if (!t.dal) return [];
  const da = stagioneDiData(t.dal);
  // Un tesseramento chiuso a luglio o dopo copre anche la stagione che comincia
  // allora; chiuso prima, no. La fine e' esclusiva: chi va via a gennaio 2025 ha
  // giocato la stagione 2024-25 e basta.
  const aRaw = t.al ? stagioneDiData(t.al) : stagioneCorrente;
  const a = Math.min(Math.max(aRaw, da), stagioneCorrente);
  const out: number[] = [];
  for (let y = da; y <= a; y++) out.push(y);
  return out;
}

export type RigaCarriera = {
  season: string;
  club: string;
  competition: string;
  country: string | null;
  status: "campionato" | "prestito" | "giovanili" | "sconosciuta";
  matches: number | null;
  goals: number | null;
};

/**
 * La carriera di un giocatore, stagione per stagione.
 *
 * Le presenze e i gol che Wikidata riporta valgono per **tutto** il periodo,
 * non per la singola stagione: chi e' stato due anni in una squadra con 52
 * presenze non ne ha fatte 26 all'anno, ne ha fatte 52 in due. Dividerle
 * sarebbe inventare, quindi si portano solo dove il periodo copre una stagione
 * sola e altrove si lasciano vuote: la riga dice comunque la cosa piu'
 * importante, cioe' **dove giocava**.
 */
export function righeCarriera(
  tappe: TappaWikidata[],
  stagioneCorrente: number,
  quante = 5,
): RigaCarriera[] {
  const out = new Map<string, RigaCarriera>();
  for (const t of tappe) {
    const stagioni = stagioniDi(t, stagioneCorrente);
    const unaSola = stagioni.length === 1;
    for (const anno of stagioni) {
      if (anno <= stagioneCorrente - quante) continue;
      const comp = t.lega ? resolveCompetition(t.lega, t.paese ?? undefined) : null;
      const riga: RigaCarriera = {
        season: etichettaStagione(anno),
        club: t.club,
        competition: comp?.key ?? "sconosciuta",
        country: t.paese ?? comp?.country ?? null,
        status: t.prestito ? "prestito" : comp ? "campionato" : "sconosciuta",
        matches: unaSola ? t.partite : null,
        goals: unaSola ? t.gol : null,
      };
      out.set(`${riga.season}|${riga.club}`, riga);
    }
  }
  return [...out.values()].sort((a, b) => b.season.localeCompare(a.season));
}

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Una POST a Wikidata: le query lunghe non stanno in una GET.
 *
 * Con pause e ritentativi, perche' il servizio e' pubblico e gratuito e si
 * difende: una raffica di query si prende una pagina HTML di errore al posto
 * del JSON. Aspettare qualche secondo e riprovare costa molto meno che perdere
 * il giro.
 */
export async function chiediAWikidata(query: string, tentativi = 4): Promise<unknown> {
  let ultimo = "";
  for (let i = 0; i < tentativi; i++) {
    if (i > 0) await attesa(3000 * i);
    const res = await fetch(WIKIDATA_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/sparql-results+json",
        "user-agent": WIKIDATA_UA,
      },
      body: new URLSearchParams({ query }).toString(),
    });
    const testo = await res.text();
    if (testo.trim().startsWith("{")) return JSON.parse(testo);
    ultimo = `${res.status} ${testo.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 120)}`;
  }
  throw new Error(`Wikidata non risponde: ${ultimo}`);
}
