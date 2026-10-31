import { clamp, type Valuation } from "./valuation";
import {
  ROLES,
  ROLE_LABEL,
  type AuctionEventRow,
  type LeagueRow,
  type ParticipantRow,
  type PlayerRow,
  type Role,
  type RoleMap,
} from "./types";

export type TeamState = {
  participant: ParticipantRow;
  isMe: boolean;
  spent: number;
  remaining: number;
  bought: RoleMap<number>;
  spentByRole: RoleMap<number>;
  slotsLeft: RoleMap<number>;
  totalSlotsLeft: number;
  /**
   * Il massimo che puo' offrire adesso: deve tenere 1 credito per ogni altro
   * slot ancora da riempire, altrimenti non completa la rosa.
   */
  maxBid: number;
  roster: RosterEntry[];
};

export type RosterEntry = {
  player: PlayerRow;
  price: number;
  valuation?: Valuation;
  eventId: string;
};

export type MarketState = {
  league: LeagueRow;
  teams: TeamState[];
  me: TeamState | null;
  takenPlayerIds: Set<string>;
  eventsAssigned: number;
  /** >1 = si sta pagando piu' del valore, <1 = si sta risparmiando. */
  inflation: number;
  inflationByRole: RoleMap<number>;
  creditsSpentTotal: number;
  creditsLeftTotal: number;
  /** Valore complessivo dei giocatori ancora da assegnare che finiranno in rosa. */
  valueLeftTotal: number;
  /** Quanti slot restano da riempire in tutta la lega, per ruolo. */
  slotsLeftLeague: RoleMap<number>;
};

const emptyRoleMap = (v = 0): RoleMap<number> => ({ P: v, D: v, C: v, A: v });

export function buildMarketState(args: {
  league: LeagueRow;
  participants: ParticipantRow[];
  events: AuctionEventRow[];
  players: Map<string, PlayerRow>;
  valuations?: Map<string, Valuation>;
  myParticipantId?: string | null;
}): MarketState {
  const { league, participants, events, players, valuations, myParticipantId } = args;

  const teams = new Map<string, TeamState>();
  for (const p of participants) {
    teams.set(p.id, {
      participant: p,
      isMe: p.id === myParticipantId,
      spent: 0,
      remaining: p.budget_total,
      bought: emptyRoleMap(),
      spentByRole: emptyRoleMap(),
      slotsLeft: { ...league.slots },
      totalSlotsLeft: ROLES.reduce((a, r) => a + league.slots[r], 0),
      maxBid: 0,
      roster: [],
    });
  }

  const takenPlayerIds = new Set<string>();
  let paid = 0;
  let expected = 0;
  const paidByRole = emptyRoleMap();
  const expectedByRole = emptyRoleMap();
  const eventsByRole = emptyRoleMap();
  let eventsAssigned = 0;

  for (const ev of events) {
    if (ev.outcome !== "assigned") continue;
    takenPlayerIds.add(ev.player_id);
    eventsAssigned += 1;
    const player = players.get(ev.player_id);
    if (!player) continue;
    const val = valuations?.get(ev.player_id);
    paid += ev.price;
    paidByRole[player.role] += ev.price;
    eventsByRole[player.role] += 1;
    if (val) {
      expected += val.baseValue;
      expectedByRole[player.role] += val.baseValue;
    }
    const team = ev.participant_id ? teams.get(ev.participant_id) : undefined;
    if (!team) continue;
    team.spent += ev.price;
    team.remaining -= ev.price;
    team.bought[player.role] += 1;
    team.spentByRole[player.role] += ev.price;
    team.slotsLeft[player.role] = Math.max(0, team.slotsLeft[player.role] - 1);
    team.totalSlotsLeft = Math.max(0, team.totalSlotsLeft - 1);
    team.roster.push({ player, price: ev.price, valuation: val, eventId: ev.id });
  }

  for (const team of teams.values()) {
    team.maxBid =
      team.totalSlotsLeft <= 0 ? 0 : Math.max(0, team.remaining - (team.totalSlotsLeft - 1));
    team.roster.sort((a, b) => b.price - a.price);
  }

  const slotsLeftLeague = emptyRoleMap();
  let creditsLeftTotal = 0;
  for (const team of teams.values()) {
    creditsLeftTotal += team.remaining;
    for (const r of ROLES) slotsLeftLeague[r] += team.slotsLeft[r];
  }

  // Le squadre che ancora non si sono iscritte contano lo stesso.
  //
  // Una lega dichiarata da otto con tre iscritti non e' un'asta da tre: gli
  // altri cinque arrivano prima di cominciare. Contando solo gli iscritti,
  // l'inflazione confrontava i crediti di tre squadre con i giocatori che ne
  // serviranno a otto, e diceva -50% prima che l'asta cominciasse — proprio
  // mentre uno guarda i prezzi per farsi un'idea.
  const mancanti = Math.max(0, (league.n_participants ?? teams.size) - teams.size);
  if (mancanti > 0) {
    creditsLeftTotal += mancanti * (league.budget ?? 500);
    for (const r of ROLES) slotsLeftLeague[r] += mancanti * (league.slots[r] ?? 0);
  }

  // -------------------------------------------------------------------------
  // Inflazione.
  //
  // Un'asta e' a somma zero: i crediti in circolazione sono fissi e alla fine
  // vengono spesi tutti. Quindi la domanda giusta non e' "quanto si e' pagato
  // finora" ma "quanti soldi restano rispetto al valore che resta". Se in
  // apertura ci si svena sugli attaccanti, tutto il resto dell'asta va
  // automaticamente a sconto: e' li' che si vincono le aste.
  // -------------------------------------------------------------------------
  const valueLeftByRole = emptyRoleMap();
  if (valuations) {
    for (const r of ROLES) {
      const pool: number[] = [];
      for (const [id, player] of players) {
        if (player.role !== r || takenPlayerIds.has(id)) continue;
        pool.push(valuations.get(id)?.baseValue ?? 1);
      }
      pool.sort((a, b) => b - a);
      // Contano solo i giocatori che verranno effettivamente comprati.
      valueLeftByRole[r] = pool.slice(0, slotsLeftLeague[r]).reduce((a, b) => a + b, 0);
    }
  }
  const valueLeftTotal = ROLES.reduce((a, r) => a + valueLeftByRole[r], 0);

  const inflation =
    valueLeftTotal > 0 ? clamp(creditsLeftTotal / valueLeftTotal, 0.5, 2) : 1;

  // Scostamento del singolo ruolo rispetto all'andamento medio dell'asta,
  // attenuato finche' su quel ruolo ci sono pochi acquisti registrati.
  const globalRatio = expected > 0 ? paid / expected : 1;
  const inflationByRole = emptyRoleMap(inflation);
  for (const r of ROLES) {
    const n = eventsByRole[r];
    if (n === 0 || expectedByRole[r] <= 0) continue;
    const roleRatio = paidByRole[r] / expectedByRole[r];
    const relative = globalRatio > 0 ? roleRatio / globalRatio : 1;
    const w = n / (n + 5);
    inflationByRole[r] = clamp(inflation * (1 + w * (relative - 1)), 0.5, 2);
  }

  const list = [...teams.values()];
  return {
    league,
    teams: list,
    me: list.find((t) => t.isMe) ?? null,
    takenPlayerIds,
    eventsAssigned,
    inflation,
    inflationByRole,
    creditsSpentTotal: paid,
    creditsLeftTotal,
    valueLeftTotal,
    slotsLeftLeague,
  };
}

/**
 * Il massimo che un avversario puo' realisticamente offrire per questo ruolo.
 * Se nessuno puo' arrivare a 40, offrire 45 e' regalare crediti.
 */
export function rivalCeiling(state: MarketState, role: Role): { max: number; who: string | null } {
  let max = 0;
  let who: string | null = null;
  for (const team of state.teams) {
    if (team.isMe) continue;
    if (team.slotsLeft[role] <= 0) continue;
    if (team.maxBid > max) {
      max = team.maxBid;
      who = team.participant.name;
    }
  }
  return { max, who };
}

/**
 * Chi si contende davvero un giocatore di questo prezzo.
 *
 * Contava gli avversari con uno slot libero e i soldi per pagarlo, e per mezza
 * asta erano tutti: con sei attaccanti da riempire, lo slot libero ce l'hanno
 * tutti fino alla fine. Il risultato e' che la domanda restava incollata a
 * sette e **la scarsita' non si muoveva mai** — misurato, dopo sei acquisti
 * registrati cambiava in 1 caso su 15.
 *
 * La domanda vera non e' "ha uno slot", e' **"gli manca ancora uno di questa
 * fascia"**. Chi ha gia' il suo attaccante da 250 non si contende il secondo da
 * 250, per quanti crediti e quanti slot gli restino: sta cercando altro.
 *
 * Quanti ne vuole ciascuno non e' una costante ma si ricava dalla fascia
 * stessa: se in quella fascia ci sono cinque giocatori e le squadre sono otto,
 * la maggior parte ne prendera' uno, e chi ce l'ha e' servito.
 */
export function contenders(args: {
  state: MarketState;
  role: Role;
  targetValue: number;
  valuations: Map<string, Valuation>;
  allPlayers: PlayerRow[];
}): TeamState[] {
  const { state, role, targetValue, valuations, allPlayers } = args;
  const lo = targetValue * 0.62;
  const hi = targetValue * 1.6;
  const dentro = (v: number | undefined) => v !== undefined && v >= lo && v <= hi;

  const fascia = allPlayers.filter((p) => p.role === role && dentro(valuations.get(p.id)?.baseValue));
  const quota = Math.max(1, Math.ceil(fascia.length / Math.max(1, state.teams.length)));

  return state.teams.filter((t) => {
    if (t.isMe || t.slotsLeft[role] <= 0 || t.maxBid < targetValue * 0.8) return false;
    const gia = t.roster.filter(
      (r) =>
        r.player.role === role &&
        dentro(r.valuation?.baseValue ?? valuations.get(r.player.id)?.baseValue),
    ).length;
    return gia < quota;
  });
}

/**
 * Rapporto fra chi cerca un giocatore di questa fascia e quanti ne restano.
 * >1 significa che la domanda supera l'offerta: il prezzo sale.
 */
export function scarcity(args: {
  state: MarketState;
  valuations: Map<string, Valuation>;
  allPlayers: PlayerRow[];
  role: Role;
  targetValue: number;
  /**
   * Il giocatore che si sta valutando. Non e' un sostituto di se stesso.
   *
   * Senza escluderlo, aprendo Lautaro Martinez la scheda rispondeva che se lo
   * perdi ti resta Lautaro Martinez. E il danno non era solo nella frase: quel
   * conteggio e' anche l'offerta con cui si misura la scarsita', quindi ogni
   * giocatore si faceva da sostituto e si abbassava il prezzo da solo — di piu'
   * proprio dove i sostituti sono pochi, cioe' dove la scarsita' conta.
   */
  excludeId?: string;
  /**
   * Ignora chi e' gia' stato comprato: serve a sapere quanto era scarso a
   * mercato intatto, cioe' il metro con cui confrontare la scarsita' di adesso.
   */
  comeAllInizio?: boolean;
}): { factor: number; supply: number; demand: number; alternatives: PlayerRow[] } {
  const { state, valuations, allPlayers, role, targetValue, excludeId, comeAllInizio } = args;
  const lo = targetValue * 0.62;
  const hi = targetValue * 1.6;

  const alternatives = allPlayers
    .filter(
      (p) =>
        p.role === role && p.id !== excludeId && (comeAllInizio || !state.takenPlayerIds.has(p.id)),
    )
    .map((p) => ({ p, v: valuations.get(p.id)?.baseValue ?? 0 }))
    .filter((x) => x.v >= lo && x.v <= hi)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.p);

  const supply = alternatives.length;
  const demand = contenders({ state, role, targetValue, valuations, allPlayers }).length;

  if (supply === 0) {
    return { factor: demand > 0 ? 1.45 : 1, supply, demand, alternatives };
  }
  const pressure = (demand - supply) / Math.max(supply, 1);
  return {
    factor: clamp(1 + 0.16 * pressure, 0.82, 1.45),
    supply,
    demand,
    alternatives: alternatives.slice(0, 6),
  };
}

/**
 * Perche' quella registrazione non sta in piedi, se c'e' un perche'.
 *
 * Ogni squadra deve poter riempire la rosa: chi ha 131 crediti e 23 giocatori
 * ancora da comprare non puo' offrirne piu' di 109, o resta con dei buchi. Il
 * motore quel numero lo conosce da sempre — e' `maxBid`, ed e' gia' il tetto
 * dei consigli — ma il riquadro che registra chi ha preso chi non lo guardava.
 * Cosi' un'asta di prova e' finita con un credito in mano e ventidue slot
 * vuoti, con il software che diceva "max 1" e il modulo che accettava 130.
 *
 * Torna una frase da mostrare, non un booleano: chi la legge deve capire da
 * quale conto esce il limite, altrimenti sembra un capriccio.
 */
export function perchePrezzoImpossibile(args: {
  state: MarketState;
  participantId: string | null;
  price: number;
  role: Role;
  /** L'evento gia' registrato su questo giocatore, se lo stai correggendo. */
  precedente?: { participantId: string | null; price: number } | null;
}): string | null {
  const { state, participantId, price, role, precedente } = args;
  if (!participantId) return null; // "non lo so": non c'e' nessuna cassa da controllare
  const team = state.teams.find((t) => t.participant.id === participantId);
  if (!team) return null;

  // Correggere un acquisto gia' registrato non e' comprare un giocatore in
  // piu': quello che c'era va prima restituito.
  const suo = precedente && precedente.participantId === participantId;
  const crediti = team.remaining + (suo ? precedente.price : 0);
  const slots = team.totalSlotsLeft + (suo ? 1 : 0);
  const slotsRuolo = team.slotsLeft[role] + (suo ? 1 : 0);

  if (slotsRuolo <= 0)
    return `${team.participant.name} ha gia' i ${ROLE_LABEL[role].toLowerCase()} al completo.`;

  const limite = Math.max(0, crediti - (slots - 1));
  if (price > limite)
    return (
      `${team.participant.name} ha ${crediti} crediti e ${slots} giocatori ancora da comprare: ` +
      `oltre ${limite} resterebbe senza i crediti per riempire la rosa.`
    );
  return null;
}
