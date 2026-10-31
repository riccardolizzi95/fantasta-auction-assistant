import { resolveCompetition } from "./competitions";
import { ROLE_LABEL, type Role } from "./types";

/**
 * Chi e' davvero questo giocatore.
 *
 * Il listone di Fantacalcio.it abbrevia i nomi: "Ramos G." sta per Goncalo
 * Ramos. Cercare "Ramos" su un archivio mondiale restituisce centinaia di
 * omonimi e nessuna certezza. La squadra pero' la sappiamo — e' nel listone — e
 * con quella un modello con accesso al web arriva al nome completo in un colpo.
 * Da li' in poi le API sportive diventano precise.
 */
export type PlayerToIdentify = {
  id: string;
  name: string;
  team: string;
  role: string;
};

export type PreviousSpell = {
  season: string;
  club: string;
  competition: string;
  country: string;
  matches: number;
  goals: number;
  assists: number;
  minutes: number | null;
  yellow_cards: number;
  red_cards: number;
  goals_conceded: number;
  clean_sheets: number;
  rating: number | null;
};

export type CareerSeason = {
  season: string;
  club: string;
  competition: string;
  country: string;
  status:
    | "campionato"
    | "prestito"
    | "giovanili"
    | "infortunio"
    | "fuori-rosa"
    | "non-professionista"
    | "sconosciuta";
  isDebut: boolean;
};

export type Identity = {
  input: string;
  fullName: string | null;
  birthYear: number | null;
  nationality: string | null;
  confidence: "alta" | "media" | "bassa" | null;
  note: string | null;
  previous: PreviousSpell[];
  /** Prima stagione da professionista in un campionato di club. */
  debutSeason: string | null;
  debutClub: string | null;
  debutCompetition: string | null;
  /** La carriera stagione per stagione, dalla piu' recente. */
  career: CareerSeason[];
};

export function buildIdentifyPrompt(players: PlayerToIdentify[]): string {
  const elenco = players
    .map((p) => `- "${p.name}" — gioca nel ${p.team}, ruolo ${ROLE_LABEL[p.role as Role]}`)
    .join("\n");

  return `Questi calciatori militano in Serie A nella stagione 2026/27. I nomi vengono dal listone ufficiale del Fantacalcio, che li abbrevia: cognome piu' iniziale del nome ("Ramos G." e' Goncalo Ramos, "Martinez L." e' Lautaro Martinez).

${elenco}

**La squadra indicata e' certa.** E' il vincolo che risolve gli omonimi: se un cognome appartiene a venti calciatori, quello giusto e' l'unico in rosa in quella squadra. Se non lo riconosci a memoria, cerca la rosa 2026/27 di quella squadra sul sito ufficiale del club o su Transfermarkt e trova il giocatore con quel cognome e quel ruolo. Un cognome comune non e' una scusa per arrendersi: la rosa di una squadra ha venticinque nomi, non venticinquemila.

Per ognuno indica nome e cognome completi, anno di nascita, nazionalita', e poi ricostruisci la carriera: **ogni stagione dal debutto fra i professionisti a oggi**, con il club e il campionato.

Per ogni stagione indica anche cosa stava facendo, in "status":
- "campionato" — giocava in prima squadra in un campionato di club
- "prestito" — in prestito a un altro club
- "giovanili" — ancora nel settore giovanile o in una squadra riserve
- "infortunio" — fermo per gran parte della stagione
- "fuori-rosa" — in rosa ma sostanzialmente non utilizzato
- "non-professionista" — non ancora professionista (troppo giovane, o fuori dal calcio professionistico)
- "sconosciuta" — non sei riuscito a ricostruirla

E segna con "debut": true la **prima stagione da professionista in un campionato di club**. E' un'informazione importante: un ventenne al secondo anno non ha dati mancanti per le stagioni prima, semplicemente non giocava ancora.

Fermati a sei stagioni indietro: piu' indietro non serve.

- In "confidence" scrivi "alta" SOLO se hai visto il nome in una fonte (rosa ufficiale, Transfermarkt, un articolo). "media" se e' molto probabile ma non l'hai verificato. "bassa" se stai deducendo.
- Meglio "full_name": null con confidence "bassa" che un nome plausibile inventato: un nome sbagliato manda a cercare le statistiche di un'altra persona.
- In "note" una frase su come l'hai identificato e dove l'hai verificato.

Rispondi SOLO con JSON valido:
{"players":[{"input":"Ramos G.","full_name":"Goncalo Ramos","birth_year":2001,"nationality":"Portogallo","confidence":"alta","note":"attaccante portoghese, dal Paris Saint-Germain al Milan nell'estate 2026, verificato su acmilan.com","career":[{"season":"2025-26","club":"Paris Saint-Germain","competition":"Ligue 1","country":"France","status":"campionato","debut":false},{"season":"2020-21","club":"Benfica","competition":"Primeira Liga","country":"Portugal","status":"campionato","debut":true}]}]}`;
}

/**
 * Secondo passaggio: i numeri.
 *
 * Separato dall'identificazione perche' sono due ricerche diverse — una trova
 * chi e', l'altra le sue statistiche — e chiederle insieme faceva tornare solo
 * la prima.
 */
/**
 * Secondo passaggio: i numeri, un giocatore per volta.
 *
 * Chiederne sei insieme non funziona: la ricerca web restituisce una manciata di
 * risultati per l'intera richiesta, e divisi fra sei persone non bastano a
 * verificare niente. Il modello lo diceva anche esplicitamente. Una chiamata per
 * giocatore costa un paio di centesimi e torna con i dati.
 */
export function buildStatsPrompt(
  player: { name: string; fullName: string | null; team: string; role: string; clubs: string },
  seasons: string[],
): string {
  const chi = player.fullName ?? player.name;
  return `Trova le statistiche di campionato di ${chi}, ${ROLE_LABEL[player.role as Role]}, oggi al ${player.team}, per le stagioni ${seasons.join(" e ")}.${player.clubs ? `\n\nAllora giocava: ${player.clubs}.` : ""}

Cerca la sua pagina su Transfermarkt, FBref o Sofascore e leggi le presenze in campionato.

Regole tassative:
- NON inventare numeri. Ometti la stagione che non riesci a verificare.
- Solo il campionato nazionale di club: niente coppe, niente nazionali, niente giovanili.
- "matches" sono le presenze effettive in campionato.
- Se e' un PORTIERE servono anche "goals_conceded" e "clean_sheets", altrimenti ometti la stagione.
- "rating" e' il voto medio Sofascore o simili (scala 0-10), se lo trovi.

Rispondi SOLO con JSON valido:
{"players":[{"name":"${chi}","seasons":[{"season":"${seasons[0]}","club":"nome del club","competition":"nome del campionato","country":"paese","matches":31,"minutes":1900,"goals":14,"assists":5,"yellow_cards":3,"red_cards":0,"goals_conceded":0,"clean_sheets":0,"rating":7.2}]}]}`;
}

/**
 * Normalizza la stagione in "2025-26".
 *
 * I modelli la scrivono come capita: "2025/26", "2025-2026", "2025/2026",
 * "2025". Rifiutare tutto tranne una forma faceva buttare via risposte corrette.
 */
export function normalizeSeason(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  let m = t.match(/^(\d{4})\s*[-/]\s*(\d{2,4})$/);
  if (m) {
    const inizio = Number(m[1]);
    const fine = m[2].length === 4 ? Number(m[2]) % 100 : Number(m[2]);
    if ((inizio + 1) % 100 !== fine) return null;
    return `${inizio}-${String(fine).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{4})$/);
  if (m) {
    const inizio = Number(m[1]);
    return `${inizio}-${String((inizio + 1) % 100).padStart(2, "0")}`;
  }
  return null;
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type RawIdentity = {
  input?: unknown;
  name?: unknown;
  full_name?: unknown;
  birth_year?: unknown;
  nationality?: unknown;
  confidence?: unknown;
  note?: unknown;
  seasons?: unknown;
  clubs?: unknown;
  career?: unknown;
};

export function parseIdentities(
  parsed: { players?: RawIdentity[] } | null,
  players: PlayerToIdentify[],
): Map<string, Identity> {
  const out = new Map<string, Identity>();
  if (!parsed?.players) return out;

  for (const raw of parsed.players) {
    // Il primo passaggio risponde con "input" (il nome del listone), il secondo
    // con "name" (il nome completo): accettiamo entrambi.
    const input = String(raw.input ?? raw.name ?? "");
    const match =
      players.find((p) => strip(p.name) === strip(input)) ??
      players.find((p) => strip(input).includes(strip(p.name.split(/\s+/)[0])));
    if (!match) continue;

    const previous: PreviousSpell[] = [];
    const elenco = Array.isArray(raw.clubs)
      ? (raw.clubs as Record<string, unknown>[])
      : Array.isArray(raw.seasons)
        ? (raw.seasons as Record<string, unknown>[])
        : [];
    for (const s of elenco) {
      const season = normalizeSeason(s.season);
      if (!season) continue;
      const matches = Math.round(num(s.matches));
      const comp = resolveCompetition(String(s.competition ?? ""), String(s.country ?? ""));
      previous.push({
        season,
        club: String(s.club ?? ""),
        competition: comp.key,
        country: String(s.country ?? ""),
        matches,
        goals: Math.round(num(s.goals)),
        assists: Math.round(num(s.assists)),
        minutes: s.minutes != null ? Math.round(num(s.minutes)) : null,
        yellow_cards: Math.round(num(s.yellow_cards)),
        red_cards: Math.round(num(s.red_cards)),
        goals_conceded: Math.round(num(s.goals_conceded)),
        clean_sheets: Math.round(num(s.clean_sheets)),
        rating: s.rating != null && num(s.rating) > 0 ? num(s.rating) : null,
      });
    }

    const STATI = new Set([
      "campionato",
      "prestito",
      "giovanili",
      "infortunio",
      "fuori-rosa",
      "non-professionista",
      "sconosciuta",
    ]);
    const career: CareerSeason[] = [];
    for (const c of Array.isArray(raw.career) ? (raw.career as Record<string, unknown>[]) : []) {
      const season = normalizeSeason(c.season);
      if (!season) continue;
      const st = String(c.status ?? "campionato");
      career.push({
        season,
        club: String(c.club ?? ""),
        competition: resolveCompetition(String(c.competition ?? ""), String(c.country ?? "")).key,
        country: String(c.country ?? ""),
        status: (STATI.has(st) ? st : "sconosciuta") as CareerSeason["status"],
        isDebut: c.debut === true,
      });
    }
    career.sort((a, b) => (a.season < b.season ? 1 : -1));
    const debut = career.find((c) => c.isDebut) ?? career[career.length - 1] ?? null;

    const conf = String(raw.confidence ?? "").toLowerCase();
    out.set(match.id, {
      input,
      fullName: raw.full_name ? String(raw.full_name) : null,
      birthYear: raw.birth_year ? Math.round(num(raw.birth_year)) : null,
      nationality: raw.nationality ? String(raw.nationality) : null,
      confidence: conf === "alta" || conf === "media" || conf === "bassa" ? conf : null,
      note: raw.note ? String(raw.note).slice(0, 400) : null,
      previous,
      debutSeason: debut?.season ?? null,
      debutClub: debut?.club ?? null,
      debutCompetition: debut?.competition ?? null,
      career,
    });
  }
  return out;
}

/**
 * Il termine con cui interrogare un archivio sportivo.
 *
 * Meglio la parola piu' lunga del nome completo ricostruito che quella del nome
 * abbreviato: "Goncalo" trova poche persone, "Ramos" ne trova duecentocinquanta.
 */
export function searchTerm(fullName: string | null, fallback: string): string {
  const source = fullName && fullName.trim().length > 3 ? fullName : fallback;
  // Gli archivi sportivi indicizzano senza accenti: cercare "Goncalo" funziona,
  // "Gonçalo" no.
  const words = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[\s.'-]+/)
    .filter((w) => /^[A-Za-z]{4,}$/.test(w))
    .sort((a, b) => b.length - a.length);
  return words[0] ?? source.trim();
}
