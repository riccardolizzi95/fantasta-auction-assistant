/**
 * Wikidata: identita' gratuita, senza chiave e senza quota.
 *
 * E' la fonte che il progetto cercava da quando il banco ha misurato quanto vale
 * chiedere l'identita' a un modello: su dieci giocatori difficili, nove
 * ricevevano nomi diversi da configurazioni diverse. Wikidata non stima, cita —
 * e per il nostro compito e' misurata: **una query, cinque secondi, 356
 * giocatori sui 533 del listone**, con nome per esteso, data di nascita e
 * nazionalita'.
 *
 * Non copre tutto e non e' aggiornatissima, ma non e' un difetto da compensare:
 * e' il motivo per cui sta **prima** dell'archivio sportivo e non al suo posto.
 * Quello che copre gratis e' quota che l'archivio non deve spendere.
 */

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

/** Wikidata chiede di identificarsi: senza User-Agent risponde 403. */
export const WIKIDATA_UA = "FantAsta/1.0 (assistente d'asta fantacalcio; contatto via GitHub)";

/** L'entita' della Serie A su Wikidata. */
const SERIE_A = "wd:Q15804";

/**
 * Da quando in qua un tesseramento conta come "in rosa adesso".
 *
 * Serve perche' "senza data di fine" non vuol dire "ancora qui": molte voci
 * vecchie non l'hanno mai avuta, e senza questo filtro la rosa dell'Inter
 * comprendeva un giocatore nato nel 1919.
 */
const NATO_DAL = 1993;

/**
 * Gli identificativi sugli altri archivi.
 *
 * Sono la ragione piu' forte per passare da Wikidata, misurata sui giocatori di
 * Serie A che ha in archivio: Transfermarkt sul 96%, FBref sull'89%, Sofascore
 * sul 78%. FBref e Sofascore portano proprio i campi che i file ufficiali non
 * hanno — i minuti giocati non compaiono su nessuna delle 1592 righe importate,
 * e il rating italiano fuori dall'Italia non esiste.
 */
const IDENTIFICATIVI: { prop: string; chiave: string }[] = [
  { prop: "P2446", chiave: "transfermarkt" },
  { prop: "P5750", chiave: "fbref" },
  { prop: "P12302", chiave: "sofascore" },
  { prop: "P2369", chiave: "soccerway" },
];

/**
 * Tutti i tesseramenti aperti dei club di Serie A, in una query sola.
 *
 * Una query invece di venti perche' non costa niente in quota ma costa tempo:
 * venti richieste sequenziali a Wikidata sono venti secondi, una sola ne prende
 * cinque.
 */
export function rosterQuery(): string {
  const opzionali = IDENTIFICATIVI.map(
    (i) => `  OPTIONAL { ?player wdt:${i.prop} ?${i.chiave} }`,
  ).join("\n");
  const campi = IDENTIFICATIVI.map((i) => `?${i.chiave}`).join(" ");

  return `SELECT ?clubLabel ?player ?playerLabel ?dob ?natLabel ?start ?ruoloLabel ?altezza ${campi} WHERE {
  ?club wdt:P118 ${SERIE_A} .
  ?player p:P54 ?st . ?st ps:P54 ?club .
  FILTER NOT EXISTS { ?st pq:P582 ?fine }
  ?player wdt:P569 ?dob .
  FILTER(YEAR(?dob) >= ${NATO_DAL})
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?player wdt:P27 ?nat }
  OPTIONAL { ?player wdt:P413 ?ruolo }
  OPTIONAL { ?player wdt:P2048 ?altezza }
${opzionali}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "it,en". }
}`;
}

export type VoceWikidata = {
  /** L'identificativo Wikidata, tipo "Q615256". */
  qid: string;
  club: string;
  fullName: string;
  birthYear: number | null;
  nationality: string | null;
  /** Da quando risulta in quel club: fra due voci vince la piu' recente. */
  since: string | null;
  /** Il ruolo come lo dice l'enciclopedia: riscontra quello del listone, non lo sostituisce. */
  position: string | null;
  heightCm: number | null;
  /** Dove trovarlo sugli altri archivi. */
  externalIds: Record<string, string>;
};

type SparqlBinding = Record<string, { value?: string } | undefined>;

/**
 * Legge la risposta SPARQL.
 *
 * Due cose vanno sistemate qui e non a valle. La doppia cittadinanza produce
 * una riga per nazionalita', quindi lo stesso giocatore compare due volte; e un
 * giocatore rientrato da un prestito ha due tesseramenti aperti nello stesso
 * club. In entrambi i casi si tiene una voce sola, la piu' recente.
 */
export function parseRoster(json: unknown): VoceWikidata[] {
  const bindings = ((json as { results?: { bindings?: SparqlBinding[] } })?.results?.bindings ??
    []) as SparqlBinding[];

  const perChiave = new Map<string, VoceWikidata>();
  for (const b of bindings) {
    const uri = b.player?.value ?? "";
    const qid = uri.split("/").pop() ?? "";
    const fullName = (b.playerLabel?.value ?? "").trim();
    // Quando manca l'etichetta, Wikidata restituisce l'identificativo: un "Q123"
    // non e' un nome, ed e' peggio di niente perche' sembra un dato.
    if (!qid || !fullName || /^Q\d+$/.test(fullName)) continue;

    const club = (b.clubLabel?.value ?? "").trim();
    const since = b.start?.value ?? null;
    const dob = b.dob?.value ?? "";
    const externalIds: Record<string, string> = {};
    for (const i of IDENTIFICATIVI) {
      const v = b[i.chiave]?.value;
      if (v) externalIds[i.chiave] = v;
    }
    const altezza = Number(b.altezza?.value ?? NaN);
    const voce: VoceWikidata = {
      qid,
      club,
      fullName,
      birthYear: /^\d{4}/.test(dob) ? Number(dob.slice(0, 4)) : null,
      nationality: b.natLabel?.value ?? null,
      since,
      position: b.ruoloLabel?.value ?? null,
      // L'altezza arriva in due unita' diverse a seconda di chi ha scritto la
      // voce: alcune in metri (1.86), altre gia' in centimetri (186). Senza
      // distinguerle, 112 giocatori su 179 sono finiti in archivio alti
      // diciotto metri. Nessun calciatore misura tre metri, e nessuno ne misura
      // tre centimetri: la soglia separa le due unita' senza ambiguita'.
      heightCm: altezzaInCm(altezza),
      externalIds,
    };

    const chiave = `${qid}|${club}`;
    const gia = perChiave.get(chiave);
    if (!gia) {
      perChiave.set(chiave, voce);
      continue;
    }
    // Le righe dello stesso giocatore differiscono per nazionalita' o per
    // identificativo: si tiene la piu' recente ma si unisce quello che porta,
    // altrimenti un identificativo presente su una riga andrebbe perso.
    const unita: VoceWikidata = {
      ...((since ?? "") > (gia.since ?? "") ? voce : gia),
      externalIds: { ...gia.externalIds, ...voce.externalIds },
      position: gia.position ?? voce.position,
      heightCm: gia.heightCm ?? voce.heightCm,
    };
    perChiave.set(chiave, unita);
  }
  return [...perChiave.values()];
}

/**
 * Un giocatore puo' risultare in due club: e' passato da uno all'altro e la voce
 * vecchia non e' stata chiusa. Vince il tesseramento piu' recente, che e' anche
 * l'unico che puo' essere quello di adesso.
 */
/** Da metri o da centimetri a centimetri, o niente se il numero non ha senso. */
export function altezzaInCm(valore: number): number | null {
  if (!Number.isFinite(valore) || valore <= 0) return null;
  const cm = valore <= 3 ? Math.round(valore * 100) : Math.round(valore);
  return cm >= 140 && cm <= 220 ? cm : null;
}

export function soloClubPiuRecente(voci: VoceWikidata[]): VoceWikidata[] {
  const perGiocatore = new Map<string, VoceWikidata>();
  for (const v of voci) {
    const gia = perGiocatore.get(v.qid);
    if (!gia || (v.since ?? "") > (gia.since ?? "")) perGiocatore.set(v.qid, v);
  }
  return [...perGiocatore.values()];
}
