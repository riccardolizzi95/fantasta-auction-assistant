export type Role = "P" | "D" | "C" | "A";

export const ROLES: Role[] = ["P", "D", "C", "A"];

export const ROLE_LABEL: Record<Role, string> = {
  P: "Portiere",
  D: "Difensore",
  C: "Centrocampista",
  A: "Attaccante",
};

export const ROLE_PLURAL: Record<Role, string> = {
  P: "portieri",
  D: "difensori",
  C: "centrocampisti",
  A: "attaccanti",
};

export const ROLE_LABEL_SHORT: Record<Role, string> = {
  P: "Por",
  D: "Dif",
  C: "Cen",
  A: "Att",
};

export type RoleMap<T> = Record<Role, T>;

/** Regole della lega. Tutti i valori sono configurabili in fase di setup. */
export type LeagueRules = {
  /** Modificatore di difesa attivo (media voto di portiere + 3/4 difensori). */
  defense_modifier: boolean;
  /** Modificatore portiere (alcune leghe lo tengono separato). */
  goalkeeper_modifier: boolean;
  assist_enabled: boolean;
  /** Bonus per il portiere imbattuto, se la lega lo prevede. */
  clean_sheet_bonus: number;
  goal_bonus: RoleMap<number>;
  assist_bonus: number;
  yellow_card: number;
  red_card: number;
  own_goal: number;
  /** Malus al portiere per ogni gol subito. */
  goal_conceded: number;
  pen_scored: number;
  pen_missed: number;
  pen_saved: number;
  formations: string[];
};

export const DEFAULT_RULES: LeagueRules = {
  defense_modifier: false,
  goalkeeper_modifier: false,
  assist_enabled: true,
  clean_sheet_bonus: 0,
  goal_bonus: { P: 3, D: 3, C: 3, A: 3 },
  assist_bonus: 1,
  yellow_card: -0.5,
  red_card: -1,
  own_goal: -2,
  goal_conceded: -1,
  pen_scored: 3,
  pen_missed: -3,
  pen_saved: 3,
  formations: ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1"],
};

export const DEFAULT_SLOTS: RoleMap<number> = { P: 3, D: 8, C: 8, A: 6 };

/**
 * Quanti giocatori per ruolo scendono mediamente in campo ogni giornata.
 * E' la domanda "vera" del mercato: i panchinari valgono la quotazione minima.
 * Media pesata dei moduli piu' usati (3-4-3, 3-5-2, 4-3-3, 4-4-2).
 */
export const STARTERS_PER_TEAM: RoleMap<number> = { P: 1, D: 3.6, C: 4.2, A: 2.4 };

/**
 * Fantamedia e media voto di riferimento per ruolo.
 *
 * Misurate sulla Serie A 2024-25 e 2025-26, sui titolari (20+ presenze):
 * P 26 casi, D 143, C 158, A 56. Servono come centro di regressione e come
 * ripiego quando una fonte estera non da' la media voto.
 *
 * Il portiere e' il ruolo che sorprende: prende i voti piu' alti di tutti
 * (6.22) ma ha la fantamedia piu' bassa (5.11), perche' ogni gol subito vale
 * -1. Darsi per buono un 5.90 di media voto, com'era prima, penalizzava di tre
 * decimi ogni portiere stimato da un campionato estero.
 *
 * Rimisurabili con `npm run check:persistence`.
 */
export const ROLE_BASELINE_FM: RoleMap<number> = { P: 5.11, D: 6.07, C: 6.36, A: 6.85 };
export const ROLE_BASELINE_MV: RoleMap<number> = { P: 6.22, D: 5.98, C: 6.05, A: 6.1 };

/**
 * Quanto la fantamedia di una stagione predice quella successiva, per ruolo.
 *
 * Misurate sulla Serie A 2024-25 -> 2025-26 (giocatori con almeno 20 presenze in
 * entrambe): difensori 0.38 su 48 casi, centrocampisti 0.49 su 54, attaccanti
 * 0.56 su 16. Per i portieri il campione era di 10 giocatori, troppo piccolo:
 * si usa un valore prudente, in linea con i difensori.
 *
 * Il senso: la fantamedia di un difensore e' per quasi due terzi rumore che non
 * si ripete. Prenderla per buona significa pagare la fortuna dell'anno prima.
 * Rimisurabili in qualsiasi momento con `npm run check:persistence`.
 */
export const ROLE_FM_PERSISTENCE: RoleMap<number> = { P: 0.35, D: 0.38, C: 0.49, A: 0.56 };

/** Come sopra, ma per la media voto: serve al modificatore di difesa. */
export const ROLE_MV_PERSISTENCE: RoleMap<number> = { P: 0.32, D: 0.32, C: 0.46, A: 0.54 };

export type PlayerRow = {
  id: string;
  season: string;
  external_id: number | null;
  name: string;
  team: string;
  role: Role;
  /** I ruoli mantra come li scrive il file ufficiale: "Dc", "Ds", "M"... */
  role_mantra?: string[] | null;
  quotation_initial: number | null;
  quotation_current: number | null;
  fvm: number | null;
  is_active: boolean;
};

export type PlayerStatsRow = {
  player_id: string;
  season: string;
  /** Chiave della competizione: determina il coefficiente di conversione. */
  competition?: string;
  /**
   * La squadra in cui giocava quella stagione.
   *
   * Fa parte della chiave, e non e' un vezzo: chi cambia squadra a gennaio ha
   * due mezze stagioni diverse — dieci presenze in una squadra che retrocede e
   * quindici in una che vince non sono venticinque presenze qualsiasi — e in
   * una riga sola sparivano sommate. Vuota quando la fonte non la dice.
   */
  club?: string | null;
  source?: "import" | "api" | "ai" | "manual";
  /** Da dove viene la riga: fornitore, nome risolto, club, fiducia, nota. */
  source_detail?: {
    provider?: string;
    model?: string | null;
    web?: boolean;
    resolved_name?: string | null;
    api_name?: string | null;
    club?: string | null;
    confidence?: string | null;
    note?: string | null;
  } | null;
  /** Voto medio della fonte esterna (scala ~0-10), da convertire in media voto. */
  rating?: number | null;
  matches: number;
  minutes: number | null;
  avg_vote: number | null;
  avg_fantavote: number | null;
  goals: number;
  assists: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  pen_scored: number;
  pen_missed: number;
  pen_saved: number;
  goals_conceded: number;
  clean_sheets: number;
};

export type ParticipantRow = {
  id: string;
  league_id: string;
  name: string;
  user_id: string | null;
  budget_total: number;
};

/** Un acquisto annullato: chi era, di chi era, e a quanto. */
export type Rimozione = {
  playerId: string;
  participantId: string | null;
  prezzo: number;
  quando: number;
};

/**
 * Un acquisto gia' registrato che cambia padrone, o cifra.
 *
 * Sul tabellone un errore si corregge cosi': si sposta il giocatore nella
 * squadra giusta, o gli si cambia il prezzo. Da noi la riga si aggiornava in
 * silenzio — stessa riga, altro nome — e i crediti di due squadre si muovevano
 * senza che nessuno vedesse perche'. E' la correzione di un fatto: va detta.
 */
export type Spostamento = {
  playerId: string;
  daParticipant: string | null;
  aParticipant: string | null;
  prezzoPrima: number;
  prezzo: number;
  quando: number;
};

/** Un rilancio sentito durante una chiamata: quanto, e da chi. */
export type Puntata = { prezzo: number; chi: string | null; quando: number };

export type AuctionEventRow = {
  id: string;
  league_id: string;
  player_id: string;
  participant_id: string | null;
  price: number;
  outcome: "assigned" | "unsold";
  created_at: string;
};

export type LeagueRow = {
  id: string;
  name: string;
  season: string;
  mode: "classic" | "mantra";
  owner_id: string;
  budget: number;
  n_participants: number;
  slots: RoleMap<number>;
  rules: LeagueRules;
  auction_format: "chiamata" | "ordine_ruolo" | "random";
  status: "setup" | "auction" | "done";
  invite_code: string;
  /**
   * Il giocatore che il banditore sta chiamando adesso, per tutta la lega.
   *
   * Cercare e' privato — ognuno guarda chi vuole — ma *chi e' sul piatto* e' un
   * fatto solo, e deve essere lo stesso su tutti gli schermi. Lo dice chi
   * conduce: un premium o un amministratore.
   */
  current_player_id?: string | null;
  /** A quanto siamo nella chiamata in corso, e chi e' davanti. */
  current_price?: number | null;
  current_bidder?: string | null;
  /**
   * Se qualcuno ha confermato che il giocatore sul piatto e' proprio quello.
   *
   * Prima della conferma il nome e' un'ipotesi — l'ha proposto il microfono, e
   * il microfono sbaglia. Dopo, non si muove piu' fino a chiamata chiusa,
   * nemmeno se il banditore ne nomina un altro mentre conta.
   */
  current_locked?: boolean;
  /**
   * Quanto sono andati i piu' cari in un'asta passata di questa lega.
   *
   * Serve a tarare quanto il modello concentra i prezzi sui migliori. Senza,
   * si usa il listino ufficiale — che pero' e' un prezziario e non il verbale
   * di un'asta, e sottostima i top di circa la meta'.
   */
  top_prices?: { prices: number[]; budget: number } | null;
  /**
   * Il segreto del ponte con FantaAstaLive.
   *
   * Chi ce l'ha puo' dire alla lega chi e' in asta e registrare acquisti, e
   * nient'altro. Sta qui perche' il codice che legge il tabellone gira su un
   * altro dominio e non puo' portarsi dietro la sessione. Si revoca
   * rigenerandolo, o mettendolo a null.
   */
  bridge_token?: string | null;
  /** L'ultima diagnosi del ponte: le regioni candidate lette sul tabellone. */
  bridge_debug?: unknown;
  /**
   * Quando il ponte si e' fatto sentire l'ultima volta.
   *
   * Se e' recente il tabellone comanda, e i comandi manuali della chiamata
   * restano spenti: aggiudicare di qua mentre di la' l'asta va avanti fa
   * divergere le due rose, ed e' un guaio che si scopre a fine asta.
   */
  bridge_seen_at?: string | null;
  /**
   * I nomi delle squadre come li scrive il tabellone.
   *
   * Il ponte trova le colonne cercando i **nostri** nomi: se di la' una
   * squadra si chiama diversamente, quella colonna non si trova e i suoi
   * acquisti non arrivano mai. L'unico segno era un conteggio — "3/5 colonne"
   * — e non c'era modo di sapere quali fossero gli altri due nomi. Qui il
   * ponte deposita quello che legge, e da li' si propone l'aggancio.
   */
  bridge_squadre?: string[] | null;
};

/** Una tappa della carriera: club, campionato e cosa faceva quella stagione. */
export type CareerRow = {
  player_id: string;
  season: string;
  club: string | null;
  competition: string | null;
  country: string | null;
  status:
    | "campionato"
    | "prestito"
    | "giovanili"
    | "infortunio"
    | "fuori-rosa"
    | "non-professionista"
    | "sconosciuta";
  is_debut: boolean;
  note: string | null;
  confidence: string | null;
};

/** Chi e' davvero, ricostruito da una fonte esterna. */
export type PlayerIdentity = {
  player_id: string;
  full_name: string | null;
  birth_year: number | null;
  nationality: string | null;
  confidence: string | null;
  note: string | null;
  debut_season: string | null;
  debut_club: string | null;
  debut_competition: string | null;
  source: string | null;
  model: string | null;
};

/** Un giocatore con tutto quello che serve al motore, gia' unito alle statistiche. */
export type PlayerWithStats = PlayerRow & {
  /** La stagione piu' recente disponibile: quella che si mostra a schermo. */
  stats: PlayerStatsRow | null;
  /** Tutte le stagioni disponibili, dalla piu' recente alla piu' vecchia. */
  history: PlayerStatsRow[];
  /** Chi e', se e' stato identificato da una fonte esterna. */
  identity?: PlayerIdentity | null;
  /** La carriera stagione per stagione, dalla piu' recente. */
  career?: CareerRow[];
  /**
   * Quante partite ha saltato e perche', per stagione.
   *
   * Le presenze dicono quante ne ha giocate, non perche' ha saltato le altre —
   * e all'asta la differenza fra "era rotto" e "l'allenatore ha scelto un
   * altro" e' quella fra un rischio che si ripete e una gerarchia che puo'
   * cambiare in un'estate.
   */
  absences?: AbsenceRow[];
  /** Se e' infortunato, in dubbio o squalificato adesso. Invecchia in ore. */
  status?: StatusRow | null;
};

export type StatusRow = {
  player_id: string;
  stato: string;
  rientro: string | null;
  nota: string | null;
  confidenza: number | null;
  aggiornato_al: string;
};

export type AbsenceRow = {
  player_id: string;
  season: string;
  saltate: number;
  per_infortunio: number;
  motivo_principale: string | null;
};

/**
 * Peso di ogni stagione conclusa, dalla piu' recente. Decadimento geometrico:
 * ogni annata vale poco piu' della meta' di quella dopo. Il calcio cambia in
 * fretta, ma quattro anni buoni valgono piu' di un anno buono e basta — e piu'
 * stagioni ci sono, meno serve regredire verso la media (vedi
 * ROLE_FM_PERSISTENCE).
 *
 * Il peso viene poi moltiplicato per le presenze effettive, quindi una stagione
 * vecchia giocata poco pesa pochissimo da sola.
 */
export const SEASON_WEIGHTS = [1, 0.55, 0.3, 0.17, 0.09];
