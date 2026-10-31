import {
  contenders,
  rivalCeiling,
  scarcity,
  type MarketState,
  type TeamState,
} from "./market";
import {
  getStrategy,
  normalizeSplit,
  neutralSplitFrom,
  strategyMultipliers,
  QUOTA_GIOCATORE_DEFAULT,
} from "./strategies";
import {
  ROLES,
  ROLE_LABEL,
  ROLE_PLURAL,
  STARTERS_PER_TEAM,
  type PlayerRow,
  type PlayerWithStats,
  type Role,
  type RoleMap,
} from "./types";
import { clamp, type Valuation, type ValuationResult } from "./valuation";
import {
  contributoDaSolo,
  contributoMarginale,
  type ContestoFormazione,
  type InRosa,
} from "./formazione";
import { pianifica, probabilitaA, scalaPrezzi, type Comprabile, type Piano } from "./piano";

export type Rilancio = {
  /** Fin qui, se te lo lasciassero, l'avresti pagato quanto vale: non rischi niente. */
  gratis: number;
  /** Il tetto realistico di chi lo vuole: da qui in su non ti segue, e lo compri tu. */
  tettoRivale: number;
  /** Fin dove conviene spingere: appena sotto il suo tetto, e non oltre quello che regge la tua rosa. */
  finoA: number;
  /** Chi stai facendo pagare. */
  chi: string | null;
  /** Se molla proprio sull'ultimo rilancio, quanto paghi in piu' di quanto vale. */
  rischio: number;
  /** Se lo sta contendendo davvero (sentito dalla voce) o e' solo un rivale possibile. */
  loStaContendendo: boolean;
  testo: string;
};

export type Verdict =
  | "ULTIMO_DELLA_FASCIA"
  | "PRENDILO"
  | "AL_PREZZO_GIUSTO"
  | "SOLO_SE_SCENDE"
  | "LASCIA"
  | "NON_PUOI";

export const VERDICT_LABEL: Record<Verdict, string> = {
  ULTIMO_DELLA_FASCIA: "Prendilo adesso: non ne restano altri",
  PRENDILO: "Prendilo",
  AL_PREZZO_GIUSTO: "Vale il prezzo giusto",
  SOLO_SE_SCENDE: "Solo se scende",
  LASCIA: "Lascialo",
  NON_PUOI: "Non puoi permettertelo",
};

export type Recommendation = {
  player: PlayerRow;
  valuation: Valuation;
  /** Prezzo di equilibrio in questo momento, per questa lega e questa strategia. */
  fair: number;
  /** Prezzo a cui e' un affare: parti da qui. */
  target: number;
  /** Oltre questo non andare. */
  max: number;
  walkAway: number;
  verdict: Verdict;
  /** 0..100, quanto questo giocatore serve a te adesso. */
  priority: number;
  confidence: number;
  headline: string;
  pros: string[];
  cons: string[];
  notes: string[];
  breakdown: {
    baseValue: number;
    marketPrice: number;
    strategyMultiplier: number;
    inflation: number;
    scarcityFactor: number;
    planCap: number;
    myMaxBid: number;
    /**
     * Quanto saresti disposto a pagare guardando solo i ricambi: il prezzo
     * giusto piu' quanto vale in piu' del primo che lo sostituirebbe. Sale
     * quando i ricambi finiscono, e non e' quasi mai il tetto vero.
     */
    substitutionCap: number;
    /**
     * Il tetto di chi lo vuole davvero, corretto con quanto ha gia' pagato
     * sopra il valore in questa asta. **E' questo che ferma l'offerta**, non
     * `rivalCeiling`: il rivale piu' ricco spesso non e' fra quelli che
     * cercano ancora quel ruolo.
     */
    wantedCeiling: number;
    rivalCeiling: number;
    rivalName: string | null;
    contenders: number;
    supply: number;
    demand: number;
  };
  /**
   * Quanto aggiunge alla formazione che scenderesti in campo, in punti a
   * giornata — e quanta parte e' del suo valore da solo.
   *
   * Zero non vuol dire scarso: vuol dire che a te non serve. Il quarto
   * attaccante buono vale meno del primo perche' in campo ne schieri tre, e il
   * secondo portiere della stessa squadra non vale quasi niente perche' di
   * portieri se ne schiera uno.
   */
  formazione: { aggiunge: number; daSolo: number; quota: number };
  /**
   * Le due strade: prenderlo, o lasciarlo e spendere quei crediti altrove.
   *
   * E' la domanda che il tetto d'offerta da solo non fa. Prenderne uno da 300
   * con 302 in tasca e due slot vuoti non e' per forza un errore: dipende da
   * cosa restera' comprabile a un credito quando ci arrivi, e quello non
   * dipende dai giocatori rimasti ma da **quanti crediti restano agli altri**.
   */
  piano: Piano | null;
  /**
   * Fin dove conviene far salire il prezzo a chi lo sta comprando.
   *
   * Non e' un consiglio da usare sempre: e' quello che serve quando il giocatore
   * **non ti serve** e un avversario lo vuole. Ogni credito che gli fai spendere
   * qui e' un credito che non avra' quando arrivera' il giocatore che vuoi tu.
   * Il rischio e' preciso e va detto: se molla, te lo ritrovi in rosa.
   */
  rilancio: Rilancio | null;
  /**
   * Il tetto piu' alto fra quelli che se lo possono davvero permettere.
   *
   * Serve per la domanda opposta a quella del rilancio: non "fin dove posso
   * spingerlo" ma **"fin dove devo arrivare io"**. Un credito sopra il tetto del
   * miglior avversario e' gia' abbastanza per portarselo a casa: tutto quello
   * che si offre oltre non compra niente che non fosse gia' comprato.
   *
   * Con le voci diventa un numero, non una stima: se sento che lo stanno
   * rilanciando in due, il tetto e' il piu' alto dei due e non quello del
   * partecipante piu' ricco della lega, che magari quel giocatore non lo vuole.
   */
  tettoAvversari: { valore: number; chi: string | null; dallaVoce: boolean } | null;
  /**
   * I ricambi realistici, con quanto costerebbero e in cosa sono diversi.
   *
   * Non e' un elenco decorativo: il prezzo del migliore fra questi **e'** quello
   * che decide fino a dove conviene spingersi su di lui.
   */
  alternatives: {
    id: string;
    name: string;
    team: string;
    baseValue: number;
    /** Quanto costerebbe adesso, con la stessa formula usata per lui. */
    fair: number;
    /** In cosa gli somiglia e in cosa no, gia' scritto. */
    somiglia: string | null;
    differisce: string | null;
  }[];
  /** Quanto vale in piu' del miglior ricambio ancora disponibile. */
  premioSulRipiego: number;
};

export type RecommendInput = {
  player: PlayerWithStats;
  state: MarketState;
  valuations: ValuationResult;
  allPlayers: PlayerRow[];
  strategyKey: string;
  budgetSplit?: RoleMap<number>;
  /**
   * Chi si sta contendendo questo giocatore adesso, riconosciuto dalla voce.
   *
   * Cambia il consiglio piu' di quanto sembri: alzare il prezzo a un avversario
   * ha senso solo se quell'avversario lo vuole davvero. Se molla subito, il
   * giocatore te lo ritrovi in rosa — e non lo volevi.
   */
  inGara?: string[];
  /** Quota massima del budget che il piano mette su un giocatore solo. */
  quotaGiocatore?: number;
  /** La scala dei prezzi scritta a mano, se c'e'. */
  scalaAMano?: Partial<RoleMap<number[]>> | null;
};

function roleValueTotals(valuations: ValuationResult): RoleMap<number> {
  const out = { P: 0, D: 0, C: 0, A: 0 } as RoleMap<number>;
  for (const role of ROLES) {
    out[role] = valuations.byRole[role].reduce((a, v) => a + v.baseValue, 0);
  }
  return out;
}

/**
 * Quanto posso ancora spendere per questo ruolo senza tradire il piano, tenendo
 * da parte quello che serve per riempire gli slot rimanenti.
 */
function planCapFor(state: MarketState, role: Role, split: RoleMap<number>): number {
  const me = state.me;
  if (!me) return 0;
  const planned = split[role] * me.participant.budget_total;
  const left = planned - me.spentByRole[role];
  const slotsLeft = me.slotsLeft[role];
  if (slotsLeft <= 0) return 0;
  const startersNeeded = Math.max(
    0,
    Math.round(STARTERS_PER_TEAM[role]) - me.bought[role],
  );
  const otherStarters = Math.max(0, startersNeeded - 1);
  const benchSlots = Math.max(0, slotsLeft - 1 - otherStarters);
  const perStarter = startersNeeded > 0 ? left / startersNeeded : 0;
  // Tengo 1 credito per ogni panchinaro e il 75% della quota per gli altri titolari.
  const reserve = benchSlots * 1 + otherStarters * Math.max(1, perStarter * 0.75);
  return Math.max(1, left - reserve);
}


/**
 * Fin dove conviene alzare il prezzo a chi lo sta comprando.
 *
 * E' la mossa che all'asta si fa a voce e a occhio: un giocatore che non ti
 * serve lo stai comprando due volte, una in crediti tuoi e una in crediti che
 * togli a un avversario. La seconda e' quella che conta, perche' l'asta e' a
 * somma zero: ogni credito che un rivale brucia su un giocatore che non ti
 * interessa e' un credito che non avra' quando arrivera' quello che ti
 * interessa.
 *
 * Il rischio non e' un dettaglio da nascondere in fondo: **se molla, quel
 * giocatore te lo ritrovi in rosa**, e hai speso crediti e uno slot per uno che
 * non volevi. Per questo il numero che conta e' il tetto realistico del rivale,
 * non il tuo: sotto quel tetto lui rilancia ancora, sopra sei da solo.
 *
 * E per questo la voce cambia il consiglio. "Puo' arrivare a 96" e' una stima;
 * "lo sta rilanciando adesso" e' un fatto, e sposta il confine fra bluff e
 * regalo.
 */
function calcolaRilancio(a: {
  state: MarketState;
  role: Role;
  fair: number;
  planCap: number;
  myMaxBid: number;
  slotsLeftHere: number;
  priority: number;
  verdict: Verdict;
  inGara: string[];
  valuations: Map<string, Valuation>;
  allPlayers: PlayerRow[];
  tettoDi: (t: TeamState) => number;
}): Rilancio | null {
  // Senza slot in quel ruolo non puoi nemmeno rilanciare: non e' un consiglio,
  // e' una mossa che non esiste.
  if (a.slotsLeftHere <= 0 || a.myMaxBid <= a.fair) return null;
  // Se lo vuoi davvero non stai alzando il prezzo a nessuno: stai comprando.
  const loVuoi = a.priority >= 55 || a.verdict === "PRENDILO" || a.verdict === "ULTIMO_DELLA_FASCIA";
  if (loVuoi) return null;

  const sentiti = a.state.teams.filter(
    (t) => !t.isMe && t.slotsLeft[a.role] > 0 && a.inGara.includes(t.participant.id),
  );
  const lista =
    sentiti.length > 0
      ? sentiti
      : contenders({
          state: a.state,
          role: a.role,
          targetValue: a.fair,
          valuations: a.valuations,
          allPlayers: a.allPlayers,
        });
  if (lista.length === 0) return null;

  let chi: TeamState | null = null;
  let tetto = 0;
  for (const t of lista) {
    const x = a.tettoDi(t);
    if (x > tetto) {
      tetto = x;
      chi = t;
    }
  }
  if (!chi || tetto <= a.fair + 1) return null;

  // Fin qui non rischi: se te lo lasciano, l'hai pagato quanto vale — e quanto
  // il tuo piano ti concede, che e' il vincolo vero quando la cassa e' larga ma
  // il reparto e' gia' pieno.
  const gratis = Math.max(1, Math.min(a.fair, Math.round(a.planCap)));
  const finoA = Math.min(tetto - 1, a.myMaxBid);
  if (finoA <= gratis) return null;

  const rischio = finoA - gratis;
  const loStaContendendo = sentiti.length > 0;
  const nome = chi.participant.name;

  const testo =
    `${loStaContendendo ? `${nome} lo sta rilanciando` : `Se lo prende qualcuno e' ${nome}`}, ` +
    `e puo' arrivare a ${tetto}. Fino a ${gratis} non rischi niente: a quel prezzo, se te lo ` +
    `lasciano, l'hai pagato quanto vale. Da ${gratis} a ${finoA} ogni rilancio gli costa un ` +
    `credito che non avra' dopo, ma se molla resti tu con lui: al massimo ci rimetti ${rischio}. ` +
    `Da ${tetto} in su non ti segue piu' — quello che offri, lo paghi.`;

  return { gratis, tettoRivale: tetto, finoA, chi: nome, rischio, loStaContendendo, testo };
}

/**
 * Fin dove puo' arrivare il migliore fra chi lo vuole.
 *
 * Chi lo vuole, non chi ha piu' crediti: uno che ha gia' riempito il reparto non
 * e' un avversario su questo giocatore, per quanto sia ricco. E quando le voci
 * dicono chi sta rilanciando, la lista sono loro e basta.
 */
function tettoDegliAvversari(a: {
  state: MarketState;
  role: Role;
  fair: number;
  inGara: string[];
  valuations: Map<string, Valuation>;
  allPlayers: PlayerRow[];
  tettoDi: (t: TeamState) => number;
}): { valore: number; chi: string | null; dallaVoce: boolean } | null {
  const sentiti = a.state.teams.filter(
    (t) => !t.isMe && t.slotsLeft[a.role] > 0 && a.inGara.includes(t.participant.id),
  );
  const lista =
    sentiti.length > 0
      ? sentiti
      : contenders({
          state: a.state,
          role: a.role,
          targetValue: a.fair,
          valuations: a.valuations,
          allPlayers: a.allPlayers,
        });
  if (lista.length === 0) return null;
  let valore = 0;
  let chi: string | null = null;
  for (const t of lista) {
    const x = a.tettoDi(t);
    if (x > valore) {
      valore = x;
      chi = t.participant.name;
    }
  }
  return valore > 0 ? { valore, chi, dallaVoce: sentiti.length > 0 } : null;
}

/**
 * Quanto sopra il valore paga, questo avversario.
 *
 * La misura sul simulatore ha detto una cosa scomoda: un tetto calcolato solo
 * sul piano razionale **sottostima** gli avversari, e fermarsi li' fa perdere
 * giocatori che si volevano. Non e' un errore di formula, e' che la gente
 * all'asta non e' razionale — e questo si vede, perche' l'ha appena fatto
 * quindici volte davanti a te.
 *
 * Quindi il tetto di ciascuno si corregge con quello che ha gia' pagato in
 * questa stessa asta. Con pochi acquisti il dato e' rumore e viene tirato verso
 * l'uno: dopo mezza dozzina, e' il ritratto di come gioca.
 */
function generositaDi(team: TeamState): number {
  let speso = 0;
  let valore = 0;
  for (const r of team.roster) {
    speso += r.price;
    valore += r.valuation?.baseValue ?? 0;
  }
  if (valore <= 0) return 1;
  const peso = Math.min(1, team.roster.length / 6);
  return Math.max(0.5, Math.min(3, 1 + (speso / valore - 1) * peso));
}

/**
 * Quanto un avversario si spinge sopra la propria stima prima di mollare.
 *
 * Non e' una taratura fine: e' il margine di irrazionalita' di chi a un'asta
 * "lo voleva". Sotto l'1 nessuno rilancerebbe mai, sopra l'1.5 chiunque
 * pagherebbe il doppio di quello che pensa valga.
 */
const SOPRA_LA_STIMA = 1.25;

/**
 * Fin dove puo' arrivare davvero un avversario su **questo** giocatore.
 *
 * Il conto era rovesciato: si prendeva il **massimo** fra quanto il suo piano
 * gli concede per il ruolo e quanto vale il giocatore. Cosi' il tetto di
 * chiunque su chiunque era il budget del reparto — e il software diceva che
 * Mario poteva arrivare a 97 su un riempitivo da un credito, che non e'
 * ottimismo, e' un numero senza senso. Il budget del reparto non e' quanto
 * vuole spendere su di lui: e' il tetto di quello che **puo'** spendere in
 * tutto.
 *
 * Adesso comanda il giocatore: quanto vale, all'inflazione di oggi, con quanto
 * quella squadra sta pagando sopra i valori (`generositaDi`), piu' il margine
 * di chi si scalda. Il piano del ruolo e la cassa restano dove devono stare,
 * cioe' come **limiti**.
 *
 * Un giocatore vale per tutti quello che dice il modello: i prezzi che hai
 * messo a mano tu sulla tua rosa non entrano qui, ne' in nessun altro conto
 * sugli avversari. Sarebbe come giocare con le loro carte in mano.
 */
function tettoAvversario(args: {
  team: TeamState;
  role: Role;
  valore: number;
  inflazione: number;
  neutral: RoleMap<number>;
}): number {
  const suo =
    args.valore *
    args.inflazione *
    generositaDi(args.team) *
    bisognoDi(args.team, args.role) *
    SOPRA_LA_STIMA;
  return Math.max(1, Math.min(args.team.maxBid, Math.round(suo)));
}

/**
 * Quanto quel ruolo gli serve ancora, visto da fuori.
 *
 * L'unica cosa che di un avversario si sa davvero e' **cosa ha gia' comprato**:
 * i crediti spesi, gli slot riempiti, quanto ha pagato sopra i valori. La sua
 * strategia no — non la conosce nessuno, e leggerla sarebbe barare anche se si
 * potesse. Ma non serve: chi ha ancora tutti i titolari di un ruolo da prendere
 * si scalda su quel ruolo molto piu' di chi li ha gia'.
 *
 * Da 1.25 quando il reparto e' vuoto a 0.6 quando i titolari ci sono tutti. Non
 * e' un caso che sia asimmetrico: il ricambio lo prendi comunque, ma a un
 * credito.
 */
function bisognoDi(team: TeamState, role: Role): number {
  const titolari = Math.max(1, STARTERS_PER_TEAM[role]);
  const mancanti = Math.max(0, titolari - team.bought[role]);
  return 0.6 + 0.65 * Math.min(1, mancanti / titolari);
}

/**
 * Il mercato come sara' davvero: chi resta, a che prezzo, e con che probabilita'.
 *
 * Il prezzo non e' il valore ma **fin dove puo' arrivare chi lo vuole**: a fine
 * asta, con tutti a secco, un titolare va via a un credito. E la probabilita'
 * non e' un dettaglio: "poi riempio a un credito" e' un piano se nessuno puo'
 * rilanciare e un'illusione se in tre cercano ancora quel ruolo.
 *
 * Sta qui e non dentro `recommend` perche' la usano in due: il consiglio sul
 * singolo giocatore e la rosa che stai costruendo. Devono vedere lo stesso
 * mercato, altrimenti dicono due cose diverse sulla stessa asta.
 */
export function costruisciMercato(args: {
  state: MarketState;
  valuations: ValuationResult;
  allPlayers: PlayerRow[];
  mult: RoleMap<number>;
  inflation: number;
  tettoDiPer: (team: TeamState, role: Role, valore: number) => number;
  /** L'inflazione ruolo per ruolo, quando si prezza tutto il listone insieme. */
  inflazionePerRuolo?: RoleMap<number>;
}): Comprabile[] {
  const { state, valuations, allPlayers, mult, inflation, tettoDiPer } = args;
  return allPlayers
    .filter((p) => !state.takenPlayerIds.has(p.id))
    .map((p) => {
      const v = valuations.byPlayer.get(p.id);
      const valore = v?.baseValue ?? 1;
      // Il tetto di chi lo vuole si misura su **questo** giocatore, non su
      // quello che stavi guardando: un avversario che puo' arrivare a 200 su un
      // top non arriva a 200 su un riempitivo.
      let tetto = 0;
      const teorico = Math.max(
        1,
        Math.round(valore * mult[p.role] * (args.inflazionePerRuolo?.[p.role] ?? inflation)),
      );
      // I tetti di tutti quelli che lo vogliono, non solo il piu' alto.
      //
      // Serve per sapere una cosa che il prezzo di mercato da solo non dice:
      // **quanto costa la certezza**. Se in tre possono arrivare a 30, 45 e 52,
      // offrire 46 ne toglie di mezzo due e offrire 53 li toglie tutti — e i
      // crediti che avanzano nel piano hanno finalmente un posto dove andare.
      const rivali: { previsto: number; possibile: number }[] = [];
      for (const t of state.teams) {
        if (t.isMe || t.slotsLeft[p.role] <= 0) continue;
        const suo = tettoDiPer(t, p.role, valore);
        // Due numeri diversi: fin dove il suo piano lo porta, e fin dove
        // **potrebbe** arrivare se si scaldasse. Il secondo e' un muro, il
        // primo una previsione — e confonderli faceva dare 100% a chi aveva
        // solo sfondato una previsione.
        rivali.push({ previsto: suo, possibile: Math.max(suo, t.maxBid) });
        if (suo > tetto) tetto = suo;
      }
      rivali.sort((a, b) => b.previsto - a.previsto);
      const prezzo = Math.max(1, Math.min(teorico, tetto + 1));
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        expFM: v?.expFM ?? 0,
        expMV: v?.expMV ?? 0,
        expApps: v?.expApps ?? 0,
        prezzo,
        // Se in tre lo vogliono e possono pagarlo, tocca a te una volta su
        // quattro. Senza contendenti, e' tuo.
        // La probabilita' al prezzo di mercato, con la stessa regola che il
        // piano usa a qualunque altro prezzo: due modi di contarla darebbero
        // due risposte diverse sullo stesso giocatore.
        probabilita: probabilitaA({ rivali } as Comprabile, prezzo),
        rivali,
      };
    });
}

/**
 * Il mercato di adesso, pronto da usare fuori da `recommend`.
 *
 * Mette insieme i pezzi che la valutazione di un singolo giocatore assembla al
 * volo — la ripartizione della strategia, l'inflazione per ruolo, i tetti degli
 * avversari — perche' la rosa che stai costruendo deve vedere **lo stesso**
 * mercato del consiglio sul singolo. Due viste che non concordano sull'asta
 * sono peggio di una vista sola.
 */
export function mercatoCorrente(input: {
  state: MarketState;
  valuations: ValuationResult;
  allPlayers: PlayerRow[];
  strategyKey: string;
  budgetSplit?: RoleMap<number>;
}): Comprabile[] {
  const { state, valuations, allPlayers, strategyKey } = input;
  const strategy = getStrategy(strategyKey);
  const split = normalizeSplit(
    input.budgetSplit ?? strategy?.budgetSplit ?? { P: 0.07, D: 0.16, C: 0.33, A: 0.44 },
  );
  const neutral = neutralSplitFrom(roleValueTotals(valuations));
  const mult = strategyMultipliers(split, neutral);
  const inflazione = {} as RoleMap<number>;
  for (const r of ROLES) inflazione[r] = state.inflationByRole[r];

  return costruisciMercato({
    state,
    valuations,
    allPlayers,
    mult,
    // `costruisciMercato` vuole un numero solo: l'inflazione del ruolo la
    // applica gia' lui per giocatore, quindi qui basta la neutra.
    inflation: 1,
    tettoDiPer: (team, r, valore) =>
      tettoAvversario({ team, role: r, valore, inflazione: inflazione[r], neutral }),
    inflazionePerRuolo: inflazione,
  });
}

export function recommend(input: RecommendInput): Recommendation {
  const { player, state, valuations, allPlayers, strategyKey } = input;
  const val = valuations.byPlayer.get(player.id);
  const me = state.me;
  const role = player.role;

  const strategy = getStrategy(strategyKey);
  const split = normalizeSplit(
    input.budgetSplit ?? strategy?.budgetSplit ?? { P: 0.07, D: 0.16, C: 0.33, A: 0.44 },
  );
  const neutral = neutralSplitFrom(roleValueTotals(valuations));
  const mult = strategyMultipliers(split, neutral);

  const baseValue = val?.baseValue ?? 1;
  const inflation = state.inflationByRole[role];
  const sc = scarcity({
    state,
    valuations: valuations.byPlayer,
    allPlayers,
    role,
    targetValue: baseValue,
    excludeId: player.id,
  });

  /**
   * La scarsita' come **variazione**, non come livello assoluto.
   *
   * Quando i valori sono tarati su prezzi d'asta veri, quei prezzi contengono
   * gia' la pressione del mercato: Lautaro Martinez e' andato a 240 perche' tutti
   * volevano un attaccante e ce n'erano tre. Moltiplicare di nuovo per la
   * scarsita' la contava due volte, e il prezzo giusto usciva a 381 su un
   * giocatore che nella realta' e' costato 240.
   *
   * Quindi si confronta la scarsita' di adesso con quella che c'era a mercato
   * intatto: all'apertura il rapporto e' uno e il prezzo resta quello pagato,
   * e da li' sale davvero solo se i ricambi si esauriscono piu' in fretta della
   * domanda. Senza ancore, il valore base non contiene nessuna pressione e la
   * scarsita' va applicata per intero.
   */
  let fattoreScarsita = sc.factor;
  if (valuations.anchoredOnRealPrices) {
    const allInizio = scarcity({
      state,
      valuations: valuations.byPlayer,
      allPlayers,
      role,
      targetValue: baseValue,
      excludeId: player.id,
      comeAllInizio: true,
    });
    fattoreScarsita = sc.factor / Math.max(0.01, allInizio.factor);
  }

  const fairRaw = baseValue * mult[role] * inflation * fattoreScarsita;
  const fair = Math.max(1, Math.round(fairRaw));

  const planCap = me ? planCapFor(state, role, split) : 0;
  const myMaxBid = me ? me.maxBid : 0;
  const rc = rivalCeiling(state, role);
  const rivals = contenders({
    state,
    role,
    targetValue: baseValue,
    valuations: valuations.byPlayer,
    allPlayers,
  });

  const needsTopHere =
    !!strategy && (strategy.topTargets[role] ?? 0) > countTopsOwned(state, role, valuations);

  /**
   * Fin dove puo' arrivare davvero un avversario su questo giocatore.
   *
   * Non basta quanto ha in cassa: uno che ha gia' due attaccanti titolari non
   * spende per il terzo quello che spenderebbe per il primo. Il tetto vero e' il
   * piu' basso fra quello che puo' pagare e quello che il suo piano gli
   * concede — con il piano neutro, perche' il loro non lo conosciamo.
   */
  const tettoDiPer = (team: TeamState, r: Role, valore: number) =>
    tettoAvversario({
      team,
      role: r,
      valore,
      inflazione: state.inflationByRole[r],
      neutral,
    });
  const tettoDi = (team: TeamState) => tettoDiPer(team, role, baseValue);

  // -------------------------------------------------------------------------
  // Fin dove conviene spingersi: lo decide il ripiego, non una percentuale.
  //
  // Il tetto era il 112% del prezzo giusto, e su un attaccante da 110 voleva
  // dire fermarsi a 123 — mentre in un'asta vera un top va a piu' del doppio.
  // Non e' un errore di taratura, e' la domanda sbagliata: quanto puoi pagarlo
  // non dipende da quanto vale lui, dipende da **cosa faresti dei crediti se lo
  // perdessi**.
  //
  // Se al suo posto ne resta uno quasi uguale che costa 100, perderlo ti costa
  // poco e il tetto deve restare basso. Se non resta nessuno, perderlo ti costa
  // tutto il suo vantaggio, e il tetto e' il prezzo del ripiego piu' quel
  // vantaggio. Cosi' il tetto si muove da solo con l'asta: largo all'inizio
  // quando i ricambi ci sono, altissimo alla fine quando e' rimasto lui.
  // -------------------------------------------------------------------------
  const prezzoDi = (v: Valuation | undefined) =>
    Math.max(1, Math.round((v?.baseValue ?? 1) * mult[role] * inflation * sc.factor));

  const miglioreRipiego = sc.alternatives[0]
    ? valuations.byPlayer.get(sc.alternatives[0].id)
    : undefined;
  // Senza ricambi il ripiego e' un giocatore da un credito: perderlo costa tutto.
  // Quanto ti serve **a te**, viste le persone che hai gia' in rosa. E' la
  // stessa misura con cui `check:asta` decide chi ha fatto l'asta migliore.
  const ctxFormazione: ContestoFormazione = {
    replacementFM: valuations.replacementFM,
    replacementMV: valuations.replacementMV,
    modificatore: state.league.rules.defense_modifier,
  };
  const inRosa = (v: Valuation | undefined, ruolo: Role): InRosa => ({
    role: ruolo,
    // Senza il bonus del modificatore: quello lo calcola la linea, una volta sola.
    expFM: v?.expFM ?? 0,
    expMV: v?.expMV ?? 0,
    expApps: v?.expApps ?? 0,
  });
  const mioReparto: InRosa[] = (me?.roster ?? []).map((r) =>
    inRosa(r.valuation ?? valuations.byPlayer.get(r.player.id), r.player.role),
  );
  const candidato: InRosa = inRosa(val, role);
  //
  // Provato e buttato: usare questa quota per abbassare il tetto d'offerta e la
  // priorita'. Su dieci aste simulate i punti restano gli stessi (73.1 in
  // entrambi i casi) ma i crediti che avanzano passano da 4 a 29 — cioe' si
  // perdono giocatori senza guadagnarci niente. Il motivo e' che la rosa va
  // riempita comunque: il venticinquesimo giocatore non entra in formazione per
  // definizione, e strozzargli il prezzo fa solo comprare piu' tardi e peggio.
  //
  // Resta come informazione, che e' vera e serve a chi decide: "non entrerebbe
  // in formazione, hai gia' tre attaccanti migliori di lui" e' esattamente
  // quello che il prezzo di mercato non dice.
  // Il prezzo a cui ciascuno andra' via davvero: non quanto vale, ma fin dove
  // puo' arrivare chi lo vuole. E' qui che entra la cassa degli avversari — a
  // fine asta, con tutti a secco, un credito compra un titolare.
  const mercato: Comprabile[] = me
    ? costruisciMercato({
        state,
        valuations,
        allPlayers,
        mult,
        inflation,
        tettoDiPer,
      })
    : [];

  const aggiunge = contributoMarginale(mioReparto, candidato, ctxFormazione);
  const daSolo = contributoDaSolo(candidato, ctxFormazione);
  //
  // Provata e buttata: dire quanto quel difensore sposta **la tua** linea, per
  // via del modificatore. Misurato (`npm run check:coppie`), lo stesso difensore
  // vale +0.31 punti a giornata sia in una difesa da 5.8 sia in una da 6.4: il
  // modificatore e' lineare nell'intervallo in cui si gioca — quattro punti per
  // punto di media — e una funzione lineare non ha ne' rendimenti decrescenti
  // ne' soglie da superare. Quindi non c'e' nessun "blocco difensivo" da
  // valorizzare, il prezzo per giocatore era gia' giusto, e il riquadro "Bonus
  // modificatore" dice gia' tutto quello che c'era da dire.
  const quotaFormazione = daSolo > 0.01 ? clamp(aggiunge / daSolo, 0, 1) : 1;

  const tettoAvversari = tettoDegliAvversari({
    state,
    role,
    fair,
    inGara: input.inGara ?? [],
    valuations: valuations.byPlayer,
    allPlayers,
    tettoDi,
  });

  const prezzoRipiego = miglioreRipiego ? prezzoDi(miglioreRipiego) : 1;
  const premioSulRipiego = Math.max(0, fair - prezzoRipiego);
  const maxSostituzione = fair + premioSulRipiego;

  // Il piano di spesa cede dove non ci sono ricambi: e' li' che concentrare ha
  // senso, ed e' esattamente il momento in cui un tetto rigido fa perdere
  // l'asta. Dove i ricambi abbondano il premio e' zero e il piano resta stretto.
  const elasticita = 1 + premioSulRipiego / Math.max(1, fair);
  // Il piano di spesa dice quanto puoi mettere su quel reparto; questo dice
  // quanto di lui finisce davvero in campo. Un quarto attaccante buono e' un
  // ottimo giocatore che a te cambia poco, e il tetto deve saperlo.
  const strategicCap = planCap * (needsTopHere ? 1.3 : 1.05) * elasticita;

  const piano =
    me && mercato.length > 0
      ? pianifica({
          rosa: mioReparto,
          slotsLiberi: me.slotsLeft,
          crediti: me.remaining,
          mercato,
          candidato: {
            id: player.id,
            name: player.name,
            role,
            expFM: val?.expFM ?? 0,
            expMV: val?.expMV ?? 0,
            expApps: val?.expApps ?? 0,
            prezzo: Math.min(fair, me.maxBid),
            probabilita: 1,
          },
          ctx: ctxFormazione,
          // Il piano alternativo — quello che compreresti al posto suo — deve
          // seguire la stessa scala di prezzi del piano vero, o il pareggio
          // confronterebbe due mondi diversi.
          scala: scalaPrezzi({
            split,
            slotsLiberi: me.slotsLeft,
            spesoPerRuolo: me.spentByRole,
            topTargets: strategy?.topTargets ?? { P: 1, D: 1, C: 2, A: 1 },
            budgetTotale: me.participant.budget_total,
            tettoMax: Math.round(
              (input.quotaGiocatore ?? QUOTA_GIOCATORE_DEFAULT) * me.participant.budget_total,
            ),
            aMano: input.scalaAMano ?? null,
          }),
        })
      : null;

  let max = Math.round(maxSostituzione);
  // Provato e buttato: usare il pareggio come tetto d'offerta.
  //
  // Sulla carta e' il tetto detto nel modo giusto — il prezzo oltre il quale
  // conviene il piano B — e in effetti su dieci aste i punti salgono appena
  // (73.2 contro 73.1). Ma lascia **60 crediti su 500** in tasca, e la garanzia
  // "non lascia crediti" salta.
  //
  // Il motivo e' interessante e vale piu' della funzione: il pareggio confronta
  // due strade, ma la strada alternativa e' fatta di acquisti a loro volta
  // limitati dal pareggio. Applicato a ogni decisione, il criterio si morde la
  // coda e offre poco su tutto. E soprattutto ignora che **i crediti non spesi
  // valgono zero**: se non c'e' niente di meglio da comprare, il prezzo giusto
  // per quello che c'e' non e' uno, e' quello che ti resta.
  //
  // Limitandolo ai casi in cui il pareggio dice qualcosa (> 1) il danno sparisce
  // ma non resta nessun guadagno: 73.1 punti e 4 crediti, identico a prima.
  // Quindi resta informazione, dove serve a chi decide, e non vincolo.
  max = Math.min(max, Math.max(1, Math.round(strategicCap)));
  // Non serve mai offrire piu' di un credito sopra il tetto di chi lo vuole.
  //
  // Prima qui c'era il massimo che il **rivale piu' ricco** poteva pagare, e
  // per mezza asta non era nessun vincolo: con otto squadre da cinquecento
  // crediti, basta che una non abbia ancora speso perche' quel numero resti
  // alto e il tetto non lo veda mai. Il tetto che conta e' quello di chi
  // quel giocatore lo vuole davvero, corretto con quanto ha gia' pagato sopra
  // il valore in questa stessa asta.
  if (tettoAvversari && tettoAvversari.valore > 0) {
    max = Math.min(max, tettoAvversari.valore + 1);
  }
  if (me) max = Math.min(max, myMaxBid);
  max = Math.max(0, max);

  // Il prezzo di apertura, quando non c'e' nessuno che possa contenderlo.
  //
  // A fine asta capita: gli altri hanno finito i crediti o hanno il reparto
  // pieno, e nessuno puo' rilanciare. Aprire all'85% del valore, li', vuol dire
  // regalare crediti a un'asta che si vincerebbe a uno — ed e' proprio il
  // momento in cui quei crediti servono per l'ultimo slot.
  const nessunoPuoContenderlo = !tettoAvversari || tettoAvversari.valore < 1;
  const target = nessunoPuoContenderlo
    ? 1
    : Math.max(1, Math.min(max || 1, Math.round(fair * 0.85)));
  const walkAway = max + 1;

  const noSlot = !me || me.slotsLeft[role] <= 0;
  const cannotAfford = !me || myMaxBid < 1;

  // Quanto e' insostituibile: 0 se ce ne sono altri uguali, 1 se e' rimasto lui.
  const insostituibile = premioSulRipiego / Math.max(1, fair);

  let verdict: Verdict;
  if (noSlot || cannotAfford || max < 1) {
    verdict = noSlot ? "LASCIA" : "NON_PUOI";
  } else if (
    // L'ultimo della sua fascia, in un ruolo che ti serve: qui non si tratta,
    // perche' il prossimo che trovi e' di un altro livello.
    (val?.tier === "top" || val?.tier === "semi-top") &&
    (needsTopHere || mult[role] >= 1) &&
    (sc.supply === 0 || insostituibile >= 0.55)
  ) {
    verdict = "ULTIMO_DELLA_FASCIA";
  } else if (fair > planCap * 1.35 && !needsTopHere) {
    verdict = "SOLO_SE_SCENDE";
  } else if (
    (val?.tier === "top" || val?.tier === "semi-top") &&
    mult[role] >= 1 &&
    (needsTopHere || sc.factor >= 1.12)
  ) {
    verdict = "PRENDILO";
  } else if (mult[role] < 0.85 && val?.tier !== "top") {
    verdict = "SOLO_SE_SCENDE";
  } else {
    verdict = "AL_PREZZO_GIUSTO";
  }

  const { pros, cons, notes } = explain({
    player,
    val,
    state,
    strategyKey,
    mult: mult[role],
    sc,
    fair,
    max,
    planCap,
    rc,
    rivals: rivals.length,
    needsTopHere,
    formazione: {
      aggiunge,
      daSolo,
      quota: quotaFormazione,
      giaInRuolo: mioReparto.filter((x) => x.role === role).length,
    },
    nessunoPuoContenderlo,
    valuations,
  });

  const priority = computePriority({ val, mult: mult[role], sc: sc.factor, needsTopHere, verdict });

  return {
    player,
    valuation:
      val ??
      ({
        playerId: player.id,
        role,
        expApps: 0,
        expFM: 0,
        expMV: 0,
        defModBonus: 0,
        effFM: 0,
        reliability: 0,
        seasonPoints: 0,
        hasData: false,
        vor: 0,
        baseValue: 1,
        marketPrice: 1,
        edgeVsMarket: 1,
        tier: "riempitivo",
        rankInRole: 0,
        teamStrength: 0.5,
      } as Valuation),
    fair,
    target,
    max,
    walkAway,
    verdict,
    priority,
    confidence: Math.round((val?.reliability ?? 0) * 100),
    headline: headlineFor(verdict, player, target, max),
    pros,
    cons,
    notes,
    breakdown: {
      baseValue: Math.round(baseValue * 10) / 10,
      marketPrice: Math.round((val?.marketPrice ?? 1) * 10) / 10,
      strategyMultiplier: Math.round(mult[role] * 100) / 100,
      inflation: Math.round(inflation * 100) / 100,
      scarcityFactor: Math.round(fattoreScarsita * 100) / 100,
      planCap: Math.round(planCap),
      myMaxBid,
      substitutionCap: Math.round(maxSostituzione),
      wantedCeiling: tettoAvversari ? Math.round(tettoAvversari.valore) : 0,
      rivalCeiling: rc.max,
      rivalName: rc.who,
      contenders: rivals.length,
      supply: sc.supply,
      demand: sc.demand,
    },
    piano,
    formazione: {
      aggiunge: Math.round(aggiunge * 100) / 100,
      daSolo: Math.round(daSolo * 100) / 100,
      quota: Math.round(quotaFormazione * 100) / 100,
    },
    premioSulRipiego: Math.round(premioSulRipiego),
    tettoAvversari,
    rilancio: calcolaRilancio({
      state,
      role,
      fair,
      planCap,
      myMaxBid,
      slotsLeftHere: me?.slotsLeft[role] ?? 0,
      priority,
      verdict,
      inGara: input.inGara ?? [],
      valuations: valuations.byPlayer,
      allPlayers,
      tettoDi,
    }),
    alternatives: sc.alternatives.map((p) => ({
      ...confronta(val, valuations.byPlayer.get(p.id)),
      id: p.id,
      name: p.name,
      team: p.team,
      baseValue: Math.round(valuations.byPlayer.get(p.id)?.baseValue ?? 1),
      fair: prezzoDi(valuations.byPlayer.get(p.id)),
    })),
  };
}

function countTopsOwned(state: MarketState, role: Role, valuations: ValuationResult): number {
  if (!state.me) return 0;
  return state.me.roster.filter((r) => {
    if (r.player.role !== role) return false;
    const t = valuations.byPlayer.get(r.player.id)?.tier;
    return t === "top" || t === "semi-top";
  }).length;
}

function computePriority(args: {
  val?: Valuation;
  mult: number;
  sc: number;
  needsTopHere: boolean;
  verdict: Verdict;
}): number {
  if (args.verdict === "NON_PUOI" || args.verdict === "LASCIA") return 5;
  const tierScore =
    { top: 45, "semi-top": 34, buono: 22, scommessa: 12, riempitivo: 5 }[
      args.val?.tier ?? "riempitivo"
    ] ?? 5;
  const fit = (args.mult - 0.62) / (1.45 - 0.62); // 0..1
  const score =
    tierScore + fit * 25 + clamp((args.sc - 0.82) / 0.63, 0, 1) * 15 + (args.needsTopHere ? 15 : 0);
  return Math.round(clamp(score, 0, 100));
}

/**
 * In cosa un ricambio somiglia al giocatore e in cosa no.
 *
 * Serve a rendere utile il confronto: sapere che ne esiste uno che costa cento
 * crediti meno non basta se non si sa **cosa si perde**. Le due dimensioni che
 * contano sono quanto rende quando gioca e quanto spesso gioca, che sono due
 * cose diverse e si compensano fra loro.
 */
function confronta(
  lui: Valuation | undefined,
  altro: Valuation | undefined,
): { somiglia: string | null; differisce: string | null } {
  if (!lui || !altro) return { somiglia: null, differisce: null };
  const dFM = altro.expFM - lui.expFM;
  const dApps = altro.expApps - lui.expApps;
  const uguali: string[] = [];
  const diversi: string[] = [];

  if (Math.abs(dFM) < 0.15) uguali.push("rende quanto lui quando gioca");
  else diversi.push(`${dFM > 0 ? "+" : ""}${dFM.toFixed(2)} di fantamedia`);

  if (Math.abs(dApps) < 2) uguali.push("gioca altrettanto");
  else diversi.push(`${dApps > 0 ? "+" : ""}${Math.round(dApps)} presenze attese`);

  if (altro.teamStrength >= lui.teamStrength + 0.15) uguali.push("sta in una squadra piu' forte");
  else if (altro.teamStrength <= lui.teamStrength - 0.15) diversi.push("squadra piu' debole");

  return {
    somiglia: uguali.length ? uguali.join(", ") : null,
    differisce: diversi.length ? diversi.join(", ") : null,
  };
}

function headlineFor(verdict: Verdict, player: PlayerRow, target: number, max: number): string {
  switch (verdict) {
    case "ULTIMO_DELLA_FASCIA":
      return `Non ne restano altri come lui: apri a ${target} e spingi fino a ${max} senza esitare.`;
    case "PRENDILO":
      return `Apri a ${target}, spingi fino a ${max}. ${player.name} rientra nel piano.`;
    case "AL_PREZZO_GIUSTO":
      return `Vale ${target}. Sopra ${max} stai pagando il nome, non il rendimento.`;
    case "SOLO_SE_SCENDE":
      return `Interessante solo sotto ${target}. Non rilanciare oltre ${max}.`;
    case "LASCIA":
      return `Non ti serve: lascia che se lo prendano gli altri.`;
    case "NON_PUOI":
      return `Non hai i crediti per restare in questa asta.`;
  }
}

function explain(args: {
  player: PlayerWithStats;
  val?: Valuation;
  state: MarketState;
  strategyKey: string;
  mult: number;
  sc: { factor: number; supply: number; demand: number };
  fair: number;
  planCap: number;
  max: number;
  rc: { max: number; who: string | null };
  rivals: number;
  needsTopHere: boolean;
  valuations: ValuationResult;
  /** Quanto aggiunge alla formazione che scenderesti in campo, e quanta parte del suo valore e'. */
  formazione: { aggiunge: number; daSolo: number; quota: number; giaInRuolo: number };
  /** Nessun avversario ha insieme lo slot e i crediti per contenderlo. */
  nessunoPuoContenderlo: boolean;
}): { pros: string[]; cons: string[]; notes: string[] } {
  const { player, val, state, mult, sc, fair, planCap, rc, rivals, needsTopHere } = args;
  const { aggiunge, daSolo, quota: quotaFormazione, giaInRuolo } = args.formazione;

  // "L'ultima riga" e "la scorsa stagione" sono due cose diverse da quando il
  // campionato e' iniziato, e confonderle rovinava proprio i giocatori migliori.
  //
  // `player.stats` e' la riga piu' recente, che a settembre e' il 2026-27 con
  // due giornate giocate. Letta come "l'anno scorso" produceva, su Lautaro
  // Martinez: "Solo 2 presenze la scorsa stagione", "l'anno scorso ha giocato
  // poco (2)" e "in calo: fantamedia scesa di 2.65" — tre affermazioni false su
  // un attaccante da 33 crediti che aveva appena chiuso a 30 presenze e 17 gol,
  // e insieme gli toglieva il "titolare in tutte le ultime stagioni" che
  // meritava. Il motore la stagione in corso la pesa a parte e correttamente;
  // era solo il testo a leggerla male.
  //
  // Da qui in giu': `s` e `concluse` sono le stagioni **finite**. La stagione in
  // corso si tocca solo nel blocco che parla di giornate giocate.
  const concluse = (player.history ?? []).filter(
    (h) => h.season !== state.league.season && h.matches > 0,
  );
  const s = concluse[0] ?? null;
  const pros: string[] = [];
  const cons: string[] = [];
  const notes: string[] = [];
  const role = player.role;
  const rules = state.league.rules;

  if (val) {
    if (val.rankInRole <= 5) {
      pros.push(`E' il numero ${val.rankInRole} del suo ruolo secondo il modello.`);
    } else if (val.rankInRole <= 15) {
      pros.push(`Top 15 del ruolo (numero ${val.rankInRole}).`);
    }

    if (val.expApps >= 30) {
      pros.push(`Titolare fisso: ${Math.round(val.expApps)} presenze attese su 38.`);
    } else if (val.expApps <= 20) {
      cons.push(`Solo ${Math.round(val.expApps)} presenze attese: rotazione o infortuni.`);
    // Il caso che il prezzo di mercato non vede: e' un buon giocatore, ma tu in
    // quel ruolo hai gia' chi scende in campo al posto suo.
    if (quotaFormazione < 0.55 && daSolo > 0.2) {
      cons.push(
        quotaFormazione < 0.15
          ? `Non entrerebbe in formazione: hai gia' ${giaInRuolo} ${ROLE_LABEL[role].toLowerCase()} ` +
            `migliori di lui. Aggiunge ${aggiunge.toFixed(2)} punti a giornata invece di ${daSolo.toFixed(2)}.`
          : `Ti aggiunge ${aggiunge.toFixed(2)} punti a giornata invece di ${daSolo.toFixed(2)}: ` +
            `in quel ruolo sei gia' coperto, e paghi un giocatore che gioca a meta'.`,
      );
    }
    }

    if (val.expFM >= 6.6) pros.push(`Fantamedia attesa ${val.expFM.toFixed(2)}: da titolare inamovibile.`);
    else if (val.expFM <= 5.8 && role !== "P") cons.push(`Fantamedia attesa bassa (${val.expFM.toFixed(2)}).`);

    if (val.edgeVsMarket >= 1.2) {
      pros.push(
        `Il listino lo prezza ${Math.round(val.marketPrice)}, il modello ${Math.round(val.baseValue)}: il mercato lo sottovaluta.`,
      );
    } else if (val.edgeVsMarket <= 0.8) {
      cons.push(
        `Il listino lo prezza ${Math.round(val.marketPrice)} ma ne vale ${Math.round(val.baseValue)}: e' un nome sopravvalutato.`,
      );
    }

    if (val.teamStrength >= 0.72) pros.push(`Gioca in una delle squadre piu' forti del campionato.`);
    // Quattro o cinque rigori a stagione sono dodici punti fantacalcio, e i gol
    // su rigore si ripetono piu' di quelli su azione (60% contro 46%, misurato
    // in `npm run check:rigoristi`): e' una delle poche cose che si sanno
    // davvero in anticipo.
    if (args.nessunoPuoContenderlo && (val?.baseValue ?? 0) > 8) {
      pros.push(
        `Nessuno puo' contenderlo adesso: chi ha ancora lo slot non ha i crediti. Apri a 1.`,
      );
    }
    if (quotaFormazione >= 0.95 && aggiunge >= 0.35) {
      pros.push(
        `Aggiunge ${aggiunge.toFixed(2)} punti a giornata alla tua formazione: entra titolare.`,
      );
    }
    if (val.rigorista) {
      const r = val.rigorista;
      pros.push(
        `Tira lui i rigori: ${r.tirati} su ${r.dellaSquadra} della squadra nel ${r.stagione}.`,
      );
    }
    else if (val.teamStrength <= 0.28) cons.push(`Squadra di bassa classifica: meno occasioni di bonus.`);

    if (val.defModBonus >= 0.15) {
      pros.push(
        `Con il modificatore attivo vale ${val.defModBonus.toFixed(2)} punti in piu' a giornata grazie alla media voto.`,
      );
    } else if ((rules.defense_modifier && role === "D") && val.expMV < 5.95) {
      cons.push(`Media voto sotto la media: con il modificatore ti abbassa la difesa.`);
    }

    if (!val.hasData) {
      cons.push(`Nessuna statistica affidabile: stima basata solo sulla quotazione.`);
    }

    if (val.convertedFrom.length > 0) {
      const labels = [...new Set(val.convertedFrom.map((c) => c.label))];
      notes.push(
        `I numeri vengono da ${labels.join(", ")}, convertiti alla scala della Serie A: e' la stima piu' incerta che il software produce, ma e' anche dove gli avversari vanno completamente a naso.`,
      );
    }
  }

  if (s && s.matches > 0) {
    const bonus = (s.goals + s.assists) / s.matches;
    if (s.goals >= 10) pros.push(`${s.goals} gol l'anno scorso in ${s.matches} presenze.`);
    else if (bonus >= 0.35) pros.push(`${s.goals} gol e ${s.assists} assist: produce bonus con continuita'.`);
    if (s.pen_scored + s.pen_missed >= 3) pros.push(`Rigorista designato (${s.pen_scored} rigori segnati).`);
    if (s.matches < 20) cons.push(`Solo ${s.matches} presenze la scorsa stagione.`);
    if (s.yellow_cards / s.matches >= 0.35)
      cons.push(`${s.yellow_cards} ammonizioni: i malus gli erodono la fantamedia.`);
    if (role === "P" && s.clean_sheets > 0 && rules.clean_sheet_bonus > 0)
      pros.push(`${s.clean_sheets} clean sheet: con il bonus imbattibilita' vale di piu'.`);
  } else {
    notes.push(`Nessun dato della scorsa Serie A: nuovo acquisto, neopromosso o rientro.`);

  // Lo stato fisico di adesso.
  //
  // E' l'unica cosa che il motore non puo' dedurre dai numeri — un fermo da tre
  // settimane ha le stesse statistiche di uno in forma — ed e' anche la fonte
  // meno affidabile che abbiamo: la lettura di una ricerca sul web fatta da un
  // modello. Per questo **non tocca il prezzo**: un'informazione sbagliata che
  // dimezza un tetto in silenzio sarebbe peggio di nessuna informazione. Sta fra
  // i contro, dove si vede, con quanti giorni ha.
  if (player.status && player.status.stato !== "disponibile") {
    const giorni = Math.floor(
      (Date.now() - new Date(player.status.aggiornato_al).getTime()) / 86_400_000,
    );
    const eta =
      giorni <= 0 ? "notizia di oggi" : giorni === 1 ? "notizia di ieri" : `notizia di ${giorni} giorni fa`;
    cons.push(
      `${player.status.stato.toUpperCase()}${player.status.rientro ? `, rientro ${player.status.rientro}` : ""}` +
        `${player.status.nota ? `: ${player.status.nota}` : ""} (${eta}, il prezzo qui sopra non ne tiene conto).`,
    );
  }

  // Perche' ha saltato le partite, non quante.
  //
  // Le presenze basse le vede gia' il motore, e infatti misurato (`npm run
  // check:titolarita`) gli infortuni dell'anno prima non aggiungono niente alla
  // previsione: chi ne ha saltate piu' di otto l'anno dopo ha giocato **piu'**
  // di quanto il modello dicesse, non meno. Quindi niente malus.
  //
  // Ma il motivo cambia come si legge un numero basso, e quello serve a chi
  // decide: venti presenze per infortunio sono un rischio che puo' ripetersi;
  // venti presenze perche' c'era un altro davanti sono una gerarchia che a
  // luglio puo' essersi rovesciata.
  {
    const ultima = (player.absences ?? [])
      .filter((a) => a.season !== state.league.season)
      .sort((a, b) => (a.season < b.season ? 1 : -1))[0];
    if (ultima && ultima.per_infortunio >= 3) {
      const motivo = ultima.motivo_principale ? ` (soprattutto ${ultima.motivo_principale})` : "";
      notes.push(
        `Nel ${ultima.season} ha saltato ${ultima.per_infortunio} partite per infortunio${motivo}: ` +
          `le presenze basse di quell'anno erano quello, non una scelta tecnica.`,
      );
    } else if (ultima && ultima.saltate >= 8 && ultima.per_infortunio <= 1) {
      notes.push(
        `Nel ${ultima.season} ha saltato ${ultima.saltate} partite ma quasi mai per infortunio: ` +
          `era una scelta dell'allenatore, e le gerarchie cambiano.`,
      );
    }
  }

  // Sta fra le note e non fra i contro di proposito. E' un fatto che uno vuole
  // sapere — chi gioca in Europa gioca ogni tre giorni — ma il calo che sembra
  // ovvio non c'e': misurato su 163 giocatori (`npm run check:campionati`), chi
  // ha fatto piu' di dieci partite di coppa l'anno dopo e' **migliorato** di
  // 0.14 di fantamedia, chi non ne ha fatta nessuna e' rimasto fermo. Non e'
  // nemmeno una smentita pulita, perche' chi gioca le coppe sta in una squadra
  // piu' forte e le due cose non si separano con una sola stagione di dettaglio.
  // Quindi: il fatto si dice, il malus no.
  {
    const EUROPEE = new Set(["champions-league", "europa-league", "conference-league"]);
    const coppe = concluse
      .filter((h) => h.season === (concluse[0]?.season ?? "") && EUROPEE.has(h.competition ?? ""))
      .reduce((a, h) => a + h.matches, 0);
    if (coppe >= 5) {
      notes.push(
        `Gioca anche le coppe europee: ${coppe} partite in piu' l'anno scorso. ` +
          `Misurato, non si traduce in un calo di fantamedia l'anno dopo.`,
      );
    }
  }
  }

  // Con piu' stagioni a disposizione possiamo distinguere la costanza dal colpo
  // di fortuna, e l'annata storta dal declino. Solo stagioni concluse: due
  // giornate non sono un'annata, e messe in fila alle altre le fanno sembrare
  // tutte un declino.
  const history = concluse;
  if (history.length >= 2) {
    const recent = history[0];
    const older = history.slice(1);
    const olderApps = older.reduce((a, h) => a + h.matches, 0) / older.length;
    const olderFM =
      older.filter((h) => h.avg_fantavote != null).length > 0
        ? older
            .filter((h) => h.avg_fantavote != null)
            .reduce((a, h) => a + Number(h.avg_fantavote), 0) /
          older.filter((h) => h.avg_fantavote != null).length
        : null;

    if (history.every((h) => h.matches >= 26)) {
      pros.push(`Titolare in tutte le ultime ${history.length} stagioni: non e' un caso isolato.`);
    } else if (recent.matches < 18 && olderApps >= 26) {
      notes.push(
        `L'anno scorso ha giocato poco (${recent.matches}) ma prima era titolare (${Math.round(olderApps)} di media): il calcolo tiene conto di entrambe le cose.`,
      );
    } else if (recent.matches >= 26 && olderApps < 15) {
      pros.push(`Si e' preso il posto da titolare solo l'anno scorso: puo' ancora crescere.`);
    }

    if (olderFM != null && recent.avg_fantavote != null) {
      const delta = Number(recent.avg_fantavote) - olderFM;
      if (delta >= 0.35) pros.push(`In crescita: fantamedia salita di ${delta.toFixed(2)} rispetto agli anni prima.`);
      else if (delta <= -0.35)
        cons.push(`In calo: fantamedia scesa di ${Math.abs(delta).toFixed(2)} rispetto agli anni prima.`);
    }
  } else if (history.length === 1) {
    notes.push(`Una sola stagione di dati: carica anche gli anni precedenti per una stima piu' solida.`);
  }

  // Un giovane con poche stagioni non ha "dati mancanti": non giocava ancora.
  // Distinguere le due cose cambia come si legge la sua stima.
  const debutto = player.identity?.debut_season;
  if (debutto) {
    const anniDiCarriera =
      Number(state.league.season.slice(0, 4)) - Number(debutto.slice(0, 4));
    if (anniDiCarriera <= 2) {
      notes.push(
        `Ha debuttato fra i professionisti nel ${debutto}: ${anniDiCarriera === 1 ? "una sola stagione" : `${anniDiCarriera} stagioni`} di carriera. Poco storico non vuol dire poco valore, ma la stima e' piu' incerta e il margine di crescita piu' ampio.`,
      );
    } else if (anniDiCarriera >= 12) {
      cons.push(`Carriera lunga: ha debuttato nel ${debutto}, l'eta' inizia a pesare.`);
    }
  }

  // Campionato gia' iniziato: e' qui che gli avversari sbagliano di piu', perche'
  // reagiscono a due giornate come se fossero una stagione.
  const md = args.valuations.matchdaysPlayed;
  if (md > 0) {
    const currentRow = (player.history ?? []).find((h) => h.season === state.league.season);
    const played = currentRow?.matches ?? 0;

    if (played === 0) {
      cons.push(
        `Non ha ancora preso un voto in questo campionato (${md} giornate): infortunato o fuori dalle gerarchie.`,
      );
    } else if (played >= md) {
      pros.push(`Ha giocato tutte le ${md} giornate finora: il posto da titolare ce l'ha adesso.`);
    } else if (played <= md / 2) {
      cons.push(`Solo ${played} presenze su ${md} giornate: non e' un titolare fisso.`);
    }

    if (currentRow?.avg_fantavote != null && played > 0) {
      const now = Number(currentRow.avg_fantavote);
      const delta = now - val!.expFM;
      if (delta >= 1) {
        notes.push(
          `Partenza sparata: ${now.toFixed(2)} di fantamedia in ${played} ${played === 1 ? "partita" : "partite"}. Il modello la conta solo in parte, ma gli altri all'asta la pagheranno tutta: lascialo andare se il prezzo si gonfia.`,
        );
      } else if (delta <= -1) {
        notes.push(
          `Partenza lenta (${now.toFixed(2)} di fantamedia in ${played} ${played === 1 ? "partita" : "partite"}): ${md} giornate non cambiano quello che vale, ma possono farti risparmiare crediti.`,
        );
      }
    }
  }

  // Quando il prezzo giusto supera il tetto, chi legge vede due numeri che si
  // contraddicono. Non si contraddicono: uno dice quanto vale, l'altro quanto
  // puoi impegnarci adesso senza restare scoperto dopo. Va detto.
  if (args.fair > args.max && args.max >= 1) {
    if (args.sc.supply === 0) {
      cons.push(
        `Vale ${args.fair} ma oltre ${args.max} non puoi andare: e' il massimo che ti resta ` +
          `dovendo completare la rosa. Se ti serve davvero, i crediti vanno presi da un altro reparto.`,
      );
    } else {
      notes.push(
        `Vale ${args.fair}, ma il piano ti ferma a ${args.max} finche' ci sono ancora ` +
          `${args.sc.supply} ricambi della sua fascia. Se spariscono, il tetto sale da solo.`,
      );
    }
  }

  if (mult >= 1.15) pros.push(`Il ruolo e' quello su cui la tua strategia vuole investire.`);
  if (mult <= 0.85) cons.push(`La tua strategia su questo ruolo vuole spendere poco.`);
  if (needsTopHere) pros.push(`Ti manca ancora un elemento di fascia alta in questo ruolo.`);

  if (sc.factor >= 1.15)
    notes.push(
      `Scarsita': ${sc.demand} squadre cercano ancora un ${ROLE_LABEL[role].toLowerCase()} di questa fascia e ne restano ${sc.supply}. Il prezzo sale.`,
    );
  else if (sc.factor <= 0.92)
    notes.push(
      `Ce ne sono ancora ${sc.supply} di fascia simile per ${sc.demand} squadre interessate: puoi aspettare.`,
    );

  if (state.eventsAssigned >= 5) {
    const infl = state.inflationByRole[role];
    if (infl >= 1.1)
      notes.push(
        `In questa lega i ${ROLE_PLURAL[role]} si stanno pagando il ${Math.round((infl - 1) * 100)}% sopra il valore.`,
      );
    else if (infl <= 0.92)
      notes.push(
        `I ${ROLE_PLURAL[role]} vanno via ${Math.round((1 - infl) * 100)}% sotto il valore: e' il momento di comprarne.`,
      );
    if (state.inflation <= 0.93)
      notes.push(
        `In lega restano ${state.creditsLeftTotal} crediti per ${Math.round(state.valueLeftTotal)} di valore ancora sul mercato: da qui in avanti si compra a sconto.`,
      );
    else if (state.inflation >= 1.08)
      notes.push(
        `In lega girano ancora ${state.creditsLeftTotal} crediti per soli ${Math.round(state.valueLeftTotal)} di valore: tutti hanno soldi da bruciare, aspettati rilanci.`,
      );
  } else {
    notes.push(`Asta ancora agli inizi: l'inflazione e' una stima prudente.`);
  }

  if (rc.max > 0 && rc.max < fair)
    notes.push(
      `Nessun avversario puo' superare ${rc.max} crediti${rc.who ? ` (il piu' ricco e' ${rc.who})` : ""}: non serve offrire di piu'.`,
    );
  if (rivals === 0) notes.push(`Nessun avversario ha ancora bisogno di questo ruolo a questa fascia.`);

  if (fair > planCap * 1.2 && planCap > 0)
    cons.push(`Sfora il piano: per questo ruolo ti restano circa ${Math.round(planCap)} crediti spendibili.`);

  if (state.me && state.me.totalSlotsLeft <= 5)
    notes.push(`Ti restano ${state.me.totalSlotsLeft} slot e ${state.me.remaining} crediti: attenzione a non rimanere corto.`);

  return { pros: pros.slice(0, 6), cons: cons.slice(0, 6), notes: notes.slice(0, 5) };
}
