import { ROLE_BASELINE_MV, type Role } from "./types";

/**
 * Un campionato e quanto ci si puo' fidare di quello che ci si e' fatto dentro.
 *
 * `production` risponde a: se questo giocatore avesse fatto la stessa stagione in
 * Serie A, quanti gol e assist avrebbe prodotto? Un attaccante da 20 gol in
 * Eredivisie non ne fa 20 da noi. Uno da 15 in Serie B nemmeno.
 *
 * `reliability` e' un'altra cosa: quanto e' solido il dato in se'. Copertura
 * statistica scarsa, campionati esotici e conversioni azzardate valgono meno
 * anche quando il coefficiente e' giusto.
 */
export type Competition = {
  key: string;
  label: string;
  country: string;
  production: number;
  reliability: number;
  /** Come puo' chiamarsi nelle varie fonti. Confronto su testo normalizzato. */
  aliases: string[];
};

export const SERIE_A_KEY = "serie-a";

/**
 * Coefficienti di conversione verso la Serie A.
 *
 * Sono stime, non misure: nascono dal confronto fra rendimento prima e dopo il
 * trasferimento dei giocatori arrivati in Serie A negli ultimi anni, dai valori
 * di mercato e dal ranking UEFA. Vanno presi come ordine di grandezza. Il punto
 * non e' azzeccare il decimale: e' non trattare 20 gol in Olanda come 20 gol a
 * Milano.
 */
export const COMPETITIONS: Competition[] = [
  { key: SERIE_A_KEY, label: "Serie A", country: "Italia", production: 1.0, reliability: 1.0,
    aliases: ["serie a", "seriea", "italy serie a", "serie a enilive"] },

  // --- Top 5 europee: difficolta' comparabile ------------------------------
  { key: "premier-league", label: "Premier League", country: "Inghilterra", production: 1.0, reliability: 0.85,
    aliases: ["premier league", "english premier league", "epl", "england premier league"] },
  { key: "la-liga", label: "La Liga", country: "Spagna", production: 1.0, reliability: 0.85,
    aliases: ["la liga", "laliga", "primera division", "spain la liga", "laliga ea sports"] },
  { key: "bundesliga", label: "Bundesliga", country: "Germania", production: 0.92, reliability: 0.85,
    aliases: ["bundesliga", "1. bundesliga", "germany bundesliga"] },
  { key: "ligue-1", label: "Ligue 1", country: "Francia", production: 0.9, reliability: 0.8,
    aliases: ["ligue 1", "ligue1", "france ligue 1", "ligue 1 mcdonald s"] },

  // --- Coppe europee: pochi match ma avversari forti -----------------------
  { key: "champions-league", label: "Champions League", country: "Europa", production: 1.15, reliability: 0.55,
    aliases: ["uefa champions league", "champions league", "ucl"] },
  { key: "europa-league", label: "Europa League", country: "Europa", production: 0.95, reliability: 0.5,
    aliases: ["uefa europa league", "europa league", "uel"] },
  { key: "conference-league", label: "Conference League", country: "Europa", production: 0.8, reliability: 0.45,
    aliases: ["uefa europa conference league", "conference league", "uecl"] },

  // --- Seconde fasce europee ----------------------------------------------
  { key: "liga-portugal", label: "Liga Portugal", country: "Portogallo", production: 0.68, reliability: 0.7,
    aliases: ["primeira liga", "liga portugal", "portugal primeira liga", "liga betclic"] },
  { key: "eredivisie", label: "Eredivisie", country: "Paesi Bassi", production: 0.62, reliability: 0.7,
    aliases: ["eredivisie", "netherlands eredivisie", "holland eredivisie"] },
  { key: "championship", label: "Championship", country: "Inghilterra", production: 0.62, reliability: 0.7,
    aliases: ["championship", "efl championship", "england championship"] },
  { key: "super-lig", label: "Süper Lig", country: "Turchia", production: 0.6, reliability: 0.6,
    aliases: ["super lig", "süper lig", "turkey super lig", "trendyol super lig"] },
  { key: "jupiler-pro-league", label: "Pro League", country: "Belgio", production: 0.58, reliability: 0.65,
    aliases: ["jupiler pro league", "pro league", "belgium first division a", "first division a"] },
  { key: "liga-mx", label: "Liga MX", country: "Messico", production: 0.55, reliability: 0.5,
    aliases: ["liga mx", "mexico liga mx", "primera division mexico"] },
  { key: "brasileirao", label: "Brasileirão", country: "Brasile", production: 0.68, reliability: 0.55,
    aliases: ["serie a brazil", "brasileirao", "campeonato brasileiro", "brazil serie a"] },
  { key: "liga-profesional", label: "Liga Profesional", country: "Argentina", production: 0.62, reliability: 0.5,
    aliases: ["liga profesional argentina", "primera division argentina", "argentina liga profesional"] },
  { key: "mls", label: "MLS", country: "Stati Uniti", production: 0.52, reliability: 0.55,
    aliases: ["major league soccer", "mls", "usa major league soccer"] },
  { key: "saudi-pro-league", label: "Saudi Pro League", country: "Arabia Saudita", production: 0.52, reliability: 0.45,
    aliases: ["pro league saudi", "saudi pro league", "saudi professional league"] },
  { key: "liga-1-romania", label: "Superliga", country: "Romania", production: 0.45, reliability: 0.45,
    aliases: ["superliga", "liga i", "romania liga i"] },
  { key: "ekstraklasa", label: "Ekstraklasa", country: "Polonia", production: 0.45, reliability: 0.5,
    aliases: ["ekstraklasa", "poland ekstraklasa"] },
  { key: "super-league-greece", label: "Super League", country: "Grecia", production: 0.5, reliability: 0.5,
    aliases: ["super league 1", "super league greece", "greece super league"] },
  { key: "hnl", label: "HNL", country: "Croazia", production: 0.45, reliability: 0.45,
    aliases: ["hnl", "supersport hnl", "croatia 1. hnl", "prva hnl"] },
  { key: "liga-profesional-suiza", label: "Super League", country: "Svizzera", production: 0.5, reliability: 0.55,
    aliases: ["super league switzerland", "swiss super league", "switzerland super league"] },
  { key: "bundesliga-austria", label: "Bundesliga", country: "Austria", production: 0.48, reliability: 0.5,
    aliases: ["bundesliga austria", "austria bundesliga", "admiral bundesliga"] },
  { key: "primeira-liga-danimarca", label: "Superliga", country: "Danimarca", production: 0.48, reliability: 0.5,
    aliases: ["superliga denmark", "danish superliga", "3f superliga"] },

  // --- Serie inferiori italiane -------------------------------------------
  { key: "serie-b", label: "Serie B", country: "Italia", production: 0.45, reliability: 0.75,
    aliases: ["serie b", "serieb", "italy serie b", "serie bkt"] },
  { key: "serie-c", label: "Serie C", country: "Italia", production: 0.25, reliability: 0.55,
    aliases: ["serie c", "italy serie c", "lega pro"] },

  // --- Seconde divisioni straniere ----------------------------------------
  { key: "bundesliga-2", label: "2. Bundesliga", country: "Germania", production: 0.45, reliability: 0.6,
    aliases: ["2. bundesliga", "bundesliga 2", "germany 2. bundesliga"] },
  { key: "la-liga-2", label: "LaLiga 2", country: "Spagna", production: 0.42, reliability: 0.6,
    aliases: ["segunda division", "laliga 2", "la liga 2", "laliga hypermotion"] },
  { key: "ligue-2", label: "Ligue 2", country: "Francia", production: 0.42, reliability: 0.6,
    aliases: ["ligue 2", "france ligue 2"] },
];

/**
 * Coppa nazionale generica. Le prime giornate si giocano contro squadre di
 * categoria inferiore, quindi i gol arrivano piu' facili: la resa e' bassa, e la
 * fiducia pure perche' sono poche partite.
 */
export const DOMESTIC_CUP: Competition = {
  key: "coppa-nazionale",
  label: "Coppa nazionale",
  country: "—",
  production: 0.6,
  reliability: 0.35,
  aliases: [],
};

const CUP_WORDS = [
  "cup", "coppa", "copa", "coupe", "pokal", "beker", "taca", "kupa", "cupa",
  "shield", "supercup", "supercoppa", "supercopa", "trophy", "trofeo",
];

/**
 * Competizioni per nazionali e giovanili: non dicono niente su quanto rendera' in
 * un campionato di club, e sommarle alla stagione gonfierebbe le presenze.
 */
const SKIP_PATTERNS = [
  "world cup",
  "euro championship",
  "nations league",
  "friendlies",
  "olympic",
  "africa cup",
  "copa america",
  "asian cup",
  "gold cup",
  "qualification",
  "confederations",
  "u21",
  "u20",
  "u19",
  "u23",
  "under 21",
  "under 20",
  "under 19",
  "primavera",
  "youth league",
  "reserve",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Le fonti danno i paesi in inglese, la nostra tabella li ha in italiano. */
const COUNTRY_ALIASES: Record<string, string> = {
  italy: "italia",
  germany: "germania",
  spain: "spagna",
  england: "inghilterra",
  france: "francia",
  netherlands: "paesi bassi",
  holland: "paesi bassi",
  portugal: "portogallo",
  turkey: "turchia",
  turkiye: "turchia",
  belgium: "belgio",
  brazil: "brasile",
  mexico: "messico",
  usa: "stati uniti",
  "united states": "stati uniti",
  "saudi arabia": "arabia saudita",
  greece: "grecia",
  croatia: "croazia",
  switzerland: "svizzera",
  denmark: "danimarca",
  poland: "polonia",
  europe: "europa",
};

const countryKey = (c: string) => {
  const n = norm(c);
  return COUNTRY_ALIASES[n] ?? n;
};

const isCupName = (normalized: string) =>
  CUP_WORDS.some((w) => normalized.split(" ").includes(w));

const BY_KEY = new Map(COMPETITIONS.map((c) => [c.key, c]));
const BY_ALIAS = new Map<string, Competition>();
for (const c of COMPETITIONS) {
  BY_ALIAS.set(norm(c.label), c);
  for (const a of c.aliases) BY_ALIAS.set(norm(a), c);
}

/** Campionato non riconosciuto: assumiamo una seconda fascia, con poca fiducia. */
/**
 * Le competizioni che nello storico sono rumore.
 *
 * Coppe e campionati non riconosciuti hanno due difetti insieme: **poche
 * partite** — due di Coppa Italia, nove di Champions — e **nessuna fantamedia**,
 * perche' i voti italiani li' non esistono. A schermo diventano righe con tre
 * trattini e un numero piccolo, in mezzo alle stagioni vere: occupano il posto
 * di quello che serve e non dicono niente in piu'.
 *
 * Restano in archivio e nel motore, dove il peso per competizione le mette al
 * loro posto: e' solo la lettura che le nasconde.
 */
export const FUORI_DALLO_STORICO = new Set([
  "coppa-nazionale",
  "champions-league",
  "europa-league",
  "conference-league",
  "sconosciuta",
]);

export const nelloStorico = (key: string | null | undefined) =>
  !FUORI_DALLO_STORICO.has(key ?? SERIE_A_KEY);

export const UNKNOWN_COMPETITION: Competition = {
  key: "sconosciuta",
  label: "Campionato non riconosciuto",
  country: "—",
  production: 0.5,
  reliability: 0.3,
  aliases: [],
};

export function competitionByKey(key: string | null | undefined): Competition {
  if (!key) return BY_KEY.get(SERIE_A_KEY)!;
  return BY_KEY.get(key) ?? UNKNOWN_COMPETITION;
}

/**
 * Riconosce un campionato dal nome che arriva da una fonte esterna. Prova la
 * corrispondenza esatta, poi "nome + paese", poi un contenimento prudente.
 */
export function resolveCompetition(name: string, country?: string): Competition {
  const n = norm(name);
  if (!n) return UNKNOWN_COMPETITION;

  /** Una coppa nazionale non e' un campionato sconosciuto: sappiamo quanto vale. */
  const cup = (): Competition => ({
    ...DOMESTIC_CUP,
    label: country ? `Coppa ${country}` : DOMESTIC_CUP.label,
  });

  // Il paese va guardato per primo: "Serie A" esiste in Italia e in Brasile, e
  // scambiarle vorrebbe dire trattare il Brasileirao come il nostro campionato.
  if (country) {
    const withCountry =
      BY_ALIAS.get(norm(`${country} ${name}`)) ?? BY_ALIAS.get(norm(`${name} ${country}`));
    if (withCountry) return withCountry;

    const c = countryKey(country);
    const sameCountry = COMPETITIONS.filter((comp) => norm(comp.country) === c);
    if (sameCountry.length > 0) {
      const hit = sameCountry.find(
        (comp) => norm(comp.label) === n || comp.aliases.some((a) => norm(a) === n),
      );
      if (hit) return hit;
      // Le coppe prima del confronto approssimativo: "Coppa Italia" contiene il
      // nome del paese e verrebbe agganciata al campionato che gli somiglia.
      if (isCupName(n)) return cup();
      const loose = sameCountry.find(
        (comp) => n.includes(norm(comp.label)) || norm(comp.label).includes(n),
      );
      if (loose) return loose;
      // Il paese e' noto ma il nome no: non azzardiamo una corrispondenza presa
      // da un altro paese, meglio dichiarare che non lo riconosciamo.
      return UNKNOWN_COMPETITION;
    }
  }

  const exact = BY_ALIAS.get(n);
  if (exact) return exact;
  if (isCupName(n)) return cup();

  for (const [alias, comp] of BY_ALIAS) {
    if (alias.length >= 6 && (n.includes(alias) || alias.includes(n))) return comp;
  }
  return UNKNOWN_COMPETITION;
}

/**
 * Il voto medio delle fonti internazionali (SofaScore, WhoScored e simili) non
 * e' la media voto italiana: gira intorno a 6.8 con una dispersione piu' larga.
 * Lo riportiamo sulla scala dei quotidiani sportivi italiani, che sta sul 6.0.
 */
export function ratingToMediaVoto(rating: number | null | undefined, role: Role): number | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const converted = ROLE_BASELINE_MV[role] + (Number(rating) - 6.8) * 0.45;
  return Math.min(7.5, Math.max(4.8, converted));
}

export const COMPETITION_OPTIONS = COMPETITIONS.map((c) => ({
  key: c.key,
  label: c.country === "Italia" || c.country === "Europa" ? c.label : `${c.label} (${c.country})`,
  production: c.production,
}));

/**
 * Va ignorata del tutto? Nazionali, giovanili e squadre riserve non dicono nulla
 * su quanto rendera' in un campionato di club, e sommate alla stagione
 * gonfierebbero le presenze.
 */
export function shouldSkipCompetition(name: string, country?: string): boolean {
  const n = norm(name);
  if (!n) return true;
  // Le coppe europee per club le teniamo, anche se il paese e' "World".
  const known = BY_ALIAS.get(n);
  if (known && known.key !== UNKNOWN_COMPETITION.key) return false;
  if (SKIP_PATTERNS.some((p) => n.includes(p))) return true;
  const c = norm(country ?? "");
  return c === "world";
}
