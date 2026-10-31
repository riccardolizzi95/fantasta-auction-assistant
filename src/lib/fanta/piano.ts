/**
 * Cosa ti resta in mano dopo, se lo prendi.
 *
 * Il tetto d'offerta risponde a "quanto vale lui". La domanda vera all'asta e'
 * un'altra: **con questi crediti, e' meglio lui o quello che comprerei al suo
 * posto?** Prenderne uno da 300 con 302 in tasca e due slot vuoti non e' per
 * forza un errore — dipende da cosa restera' comprabile a un credito quando ci
 * arrivi. E quello non dipende dai giocatori che restano: dipende da **quanti
 * crediti restano agli altri**.
 *
 * Se gli avversari sono a secco, a un credito si portano a casa giocatori veri,
 * perche' nessuno puo' rilanciare. Se sono ancora carichi, a un credito restano
 * i fondi di magazzino. E' la stessa cifra — un credito — con due significati
 * opposti, e il motore lo deve sapere.
 */
import { ROLES, STARTERS_PER_TEAM, type Role, type RoleMap } from "./types";
import { puntiFormazione, type ContestoFormazione, type InRosa } from "./formazione";

export type Comprabile = {
  id: string;
  name: string;
  role: Role;
  expFM: number;
  expMV: number;
  expApps: number;
  /** Quanto costera' davvero, viste le tasche di chi lo vuole. */
  prezzo: number;
  /**
   * Quante probabilita' ci sono di prenderlo davvero, da 0 a 1.
   *
   * E' la differenza fra pianificare e sognare. "Poi riempio i due slot a un
   * credito" e' un piano se nessuno puo' rilanciare, e un'illusione se tre
   * avversari cercano ancora quel ruolo e hanno i soldi: quei giocatori da un
   * credito li prendono loro, e tu resti con quello che avanza davvero.
   */
  probabilita: number;
  /**
   * Chi altro lo vuole, e fin dove puo' arrivare.
   *
   * Due numeri diversi per ogni avversario, e la differenza e' tutto:
   * `previsto` e' fin dove il suo piano lo porterebbe — una **stima**, che lui
   * puo' benissimo sfondare se si scalda — mentre `possibile` e' il muro vero,
   * i crediti che ha in cassa tenendo da parte quelli per completare la rosa.
   */
  rivali?: { previsto: number; possibile: number }[];
};

/**
 * Quanto e' incerto il tetto che abbiamo stimato per un avversario.
 *
 * Il suo "tetto" non e' una promessa: e' quello che il suo piano suggerisce, e
 * all'asta i piani si sfondano. 18% vuol dire che chi ha in mente 50 arriva a
 * 60 una volta su quattro — che e' piu' o meno quello che succede quando due si
 * intestardiscono su un giocatore.
 */
const INCERTEZZA_TETTO = 0.18;

/**
 * Che probabilita' hai di prenderlo davvero, offrendo `prezzo`.
 *
 * La regola vecchia contava gli avversari e divideva: uno solo dava il 50%, tre
 * il 25%, nessuno il 100%. Aveva due difetti, e il secondo e' serio.
 *
 * Il primo e' che saltava a scatti — 100, 50, 33, 25 — e fra 33% e 50% non
 * c'era niente, mentre la differenza fra due offerte di un credito e' continua.
 *
 * Il secondo e' che dava **100% troppo facilmente**: bastava superare il tetto
 * *previsto* di tutti, e quel tetto e' una nostra stima del loro piano. Ma un
 * piano si sfonda. L'unico 100% onesto e' quando gli avversari **non possono**:
 * o non hanno piu' uno slot in quel ruolo, o non hanno i crediti — e quelli
 * sono muri veri, non previsioni.
 *
 * Quindi ogni avversario contribuisce con la sua probabilita' di rilanciare,
 * che scende dolcemente man mano che la tua offerta supera il suo piano, e si
 * azzera di colpo quando incontra il muro. Prenderlo vuol dire che **nessuno**
 * ti passa sopra: le probabilita' si moltiplicano.
 */
export function probabilitaA(c: Comprabile, prezzo: number): number {
  if (!c.rivali) return c.probabilita;

  // Quanti avversari sono ancora in gara a quella cifra — ma **contati a
  // frazioni**, non a teste.
  //
  // Moltiplicare le probabilita' di non essere superati ("lo prendo solo se
  // nessuno mi passa sopra") e' la risposta a un'altra domanda, e a inizio asta
  // da' il 2% su tutto: con sette rivali a bilancio pieno la probabilita' di
  // battere **tutti** su un giocatore preciso e' davvero minuscola. Ma un piano
  // non chiede quello: chiede quanti dei suoi obiettivi finiranno in rosa, e li'
  // vale la divisione — se in tre lo vogliono, tocca a te una volta su tre.
  let contendenti = 0;
  for (const r of c.rivali) {
    // Il muro: piu' di cosi' non puo' pagare, e allora non e' piu' un rivale.
    // E' l'unico modo di arrivare al 100%, ed e' giusto che sia difficile.
    if (prezzo > r.possibile) continue;
    const scala = Math.max(1, INCERTEZZA_TETTO * Math.max(1, r.previsto));
    // Logistica: al suo tetto previsto e' in equilibrio, sopra si tira indietro
    // piano, sotto e' quasi certo che rilanci. Non arriva mai a zero finche' il
    // muro non e' stato superato — perche' un piano si sfonda, un portafoglio no.
    contendenti += 1 / (1 + Math.exp((prezzo - r.previsto) / scala));
  }
  return 1 / (1 + contendenti);
}

export type Piano = {
  /** I punti a giornata della rosa se lasci perdere e spendi il budget altrove. */
  senzaDiLui: number;
  /** I punti a giornata se lo prendi a quel prezzo e riempi il resto con quello che avanza. */
  conLui: number;
  /**
   * Il prezzo oltre il quale non conviene piu': a quella cifra le due strade
   * pareggiano. E' il tetto detto nel modo giusto — non "quanto vale" ma "fino
   * a dove resti in vantaggio".
   */
  pareggio: number;
  /** Cosa compreresti col resto, se lo prendessi, e con quante probabilita'. */
  poi: { name: string; prezzo: number; probabilita: number; role: Role }[];
  /** Quanto rende, in media, un giocatore da un credito adesso. E' il termometro del mercato. */
  valoreDiUnCredito: number;
};

/**
 * Quanto rende, davvero, lo slot che vuoi riempire con questa lista.
 *
 * Non il migliore della lista: **il migliore che riuscirai a prendere**. Se il
 * primo ha una probabilita' su quattro di arrivare a te, tre volte su quattro
 * lo slot lo riempie il secondo, e cosi' via — e quello che resta in fondo vale
 * il livello di rimpiazzo.
 *
 * E' la differenza fra un piano e un elenco dei desideri, ed e' anche il punto
 * in cui il software comincia a guardare una mossa piu' in la': non "cosa
 * vorrei", ma "cosa mi lasceranno".
 */
function resaAttesa(candidati: Comprabile[], ripiego: number): number {
  let restaDaVincere = 1;
  let atteso = 0;
  for (const c of candidati) {
    const p = Math.max(0, Math.min(1, c.probabilita));
    atteso += restaDaVincere * p * c.expFM;
    restaDaVincere *= 1 - p;
    if (restaDaVincere < 0.02) break;
  }
  return atteso + restaDaVincere * ripiego;
}

/**
 * Quanto la strategia lascia ancora spendere, reparto per reparto.
 *
 * Senza questo, il piano era una cosa sola per tutte le strategie: `riempi`
 * ordinava il mercato per rendimento e comprava dall'alto, e siccome gol e
 * assist stanno in mezzo al campo, centrocampisti e attaccanti si prendevano
 * il 95% dei crediti in ogni scenario. Sceglievi "modificatore di difesa" e la
 * rosa che il pannello mostrava era identica a quella di "attacco forte".
 *
 * Il pavimento e' un credito per slot: una quota non puo' mai scendere sotto il
 * minimo che serve a riempire il reparto, altrimenti il piano lascerebbe buchi
 * per rispettare una percentuale.
 */
export function quotePerRuolo(args: {
  split: RoleMap<number>;
  budgetTotale: number;
  spesoPerRuolo: RoleMap<number>;
  slotsLiberi: RoleMap<number>;
}): RoleMap<number> {
  const out = {} as RoleMap<number>;
  for (const r of ROLES) {
    const assegnato = args.split[r] * args.budgetTotale - args.spesoPerRuolo[r];
    out[r] = Math.max(args.slotsLiberi[r], Math.round(assegnato));
  }
  return out;
}

/**
 * La scala dei prezzi: quanto vuoi spendere sul primo, sul secondo, sul terzo.
 *
 * E' il modo in cui le persone pianificano davvero un'asta — "un attaccante da
 * centoventi, uno da ottanta, quattro da dieci" — e non c'era. Il piano
 * conosceva solo un totale per reparto, quindi due strategie con la stessa
 * quota di attacco producevano la stessa rosa: cambiava quanto, mai **come**.
 *
 * La forma la danno due cose gia' presenti nella strategia: `topTargets`, cioe'
 * quante punte di diamante vuoi in quel reparto, e la quota del reparto. I
 * gradini alti prendono `PESO_TOP` volte un gradino normale, e sotto la scala
 * decade in modo geometrico. Il primo gradino non puo' superare `tettoMax`, e
 * quello che gli viene tolto si redistribuisce sugli altri: alzare o abbassare
 * il tetto **rifa' tutta la scala**, non taglia solo la cima.
 */
export function scalaPrezzi(args: {
  split: RoleMap<number>;
  slotsLiberi: RoleMap<number>;
  spesoPerRuolo: RoleMap<number>;
  topTargets: RoleMap<number>;
  budgetTotale: number;
  /** Il massimo su un giocatore solo, in crediti. */
  tettoMax?: number | null;
  /** La scala scritta a mano, se c'e': vince su tutto. */
  aMano?: Partial<RoleMap<number[]>> | null;
}): RoleMap<number[]> {
  const out = {} as RoleMap<number[]>;
  for (const r of ROLES) {
    const n = args.slotsLiberi[r];
    if (n <= 0) {
      out[r] = [];
      continue;
    }
    const scrittaAMano = args.aMano?.[r];
    if (scrittaAMano && scrittaAMano.length > 0) {
      // Presa dal fondo: se hai gia' comprato il primo attaccante, i gradini
      // che ti restano sono quelli sotto.
      const coda = scrittaAMano.slice(Math.max(0, scrittaAMano.length - n));
      out[r] = Array.from({ length: n }, (_, i) => Math.max(1, Math.round(coda[i] ?? 1)));
      continue;
    }

    const quota = Math.max(n, args.split[r] * args.budgetTotale - args.spesoPerRuolo[r]);
    const top = Math.max(0, Math.min(n, Math.round(args.topTargets[r])));
    const pesi = Array.from({ length: n }, (_, i) =>
      i < top ? PESO_TOP * Math.pow(DECADIMENTO_TOP, i) : Math.pow(DECADIMENTO, i - top),
    );
    const somma = pesi.reduce((a, x) => a + x, 0) || 1;
    let scala = pesi.map((w) => (w / somma) * quota);

    // Il tetto non taglia e basta: quello che toglie alla cima lo rimette sugli
    // altri gradini, altrimenti abbassarlo lascerebbe crediti in mano.
    const tetto = args.tettoMax && args.tettoMax > 0 ? args.tettoMax : Infinity;
    for (let giro = 0; giro < 6; giro++) {
      const eccesso = scala.reduce((a, x) => a + Math.max(0, x - tetto), 0);
      if (eccesso < 0.5) break;
      const sotto = scala.map((x) => Math.max(0, tetto - x));
      const capienza = sotto.reduce((a, x) => a + x, 0);
      if (capienza < 0.5) break;
      scala = scala.map((x, i) => Math.min(tetto, x + (sotto[i] / capienza) * eccesso));
    }

    out[r] = scala.map((x) => Math.max(1, Math.round(x)));
  }
  return out;
}

/**
 * Quanto pesa un gradino "top" rispetto a uno normale, e quanto decade la scala.
 *
 * Non sono numeri scelti a occhio: sotto un peso di 4 le strategie tornavano a
 * somigliarsi tutte, sopra 7 il primo gradino si mangiava il reparto e il resto
 * finiva a un credito — cioe' il difetto da cui siamo partiti.
 */
const PESO_TOP = 5.5;


/**
 * Due giocatori che rendono cosi' vicino da non valere la differenza di prezzo.
 *
 * Si misura sulla **resa dello slot**, non sul rendimento del giocatore, ed e'
 * per questo che va cosi' stretta.
 *
 * Va molto piu' stretto, e il motivo si e' visto rompendo tutto: la resa e' una
 * media pesata fra il giocatore e il suo ripiego, quindi i valori stanno molto
 * piu' vicini fra loro. Con la soglia tarata sul rendimento puro quasi tutti
 * sembravano equivalenti, il piano prendeva sempre il piu' economico e finiva
 * per mettere il 56% del budget in difesa.
 */
const EQUIVALENTI_RESA = 0.03;
const DECADIMENTO_TOP = 0.78;
const DECADIMENTO = 0.62;

/**
 * Riempie gli slot che restano con quello che il budget permette.
 *
 * Non e' uno zaino ottimo ed e' voluto: deve girare a ogni consiglio, mentre il
 * banditore parla. Si prende sempre il migliore che ci si puo' permettere
 * tenendo un credito per ogni slot ancora vuoto — che e' anche il modo in cui
 * si compra davvero.
 *
 * Quello che entra in rosa non e' pero' il giocatore scelto: e' il **valore
 * atteso** di quello slot, cioe' cosa ci finisce dentro tenendo conto che
 * quelli davanti potrebbero portarteli via. Cosi' un piano che si regge su
 * giocatori contesi vale meno di uno che si regge su giocatori che nessuno
 * vuole, che e' esattamente come stanno le cose.
 */
function riempi(
  rosa: InRosa[],
  slotsLiberi: RoleMap<number>,
  budget: number,
  mercato: Comprabile[],
  ctx: ContestoFormazione,
  /** Quanto vuoi spendere su ogni gradino di ogni reparto. Vedi `scalaPrezzi`. */
  scala?: RoleMap<number[]> | null,
): { rosa: InRosa[]; presi: { name: string; prezzo: number; probabilita: number; role: Role }[] } {
  const liberi = { ...slotsLiberi };
  let cassa = budget;
  const presi: { name: string; prezzo: number; probabilita: number; role: Role }[] = [];
  const dentro = [...rosa];
  const usati = new Set<string>();

  /**
   * I gradini da riempire, dal piu' caro al piu' economico.
   *
   * Si compra gradino per gradino, non "il migliore che ci si puo' permettere":
   * e' la differenza fra una rosa con una forma e una rosa con una stella e
   * undici riempitivi. Senza scala si ricade sul vecchio comportamento — serve
   * ai controlli e a chi non ha ancora una strategia.
   */
  const gradini: { role: Role; target: number }[] = [];
  for (const r of ROLES) {
    const s = scala?.[r] ?? [];
    for (let i = 0; i < liberi[r]; i++) {
      gradini.push({ role: r, target: s[i] ?? Math.max(1, Math.floor(budget / Math.max(1, ROLES.reduce((a, x) => a + liberi[x], 0)))) });
    }
  }
  gradini.sort((a, b) => b.target - a.target);

  const perRuolo = new Map<Role, Comprabile[]>();
  for (const r of ROLES) {
    perRuolo.set(
      r,
      mercato.filter((c) => c.role === r).sort((a, b) => b.expFM - a.expFM),
    );
  }

  // Quello che un gradino non riesce a spendere non si perde: passa al
  // prossimo. Senza, una scala che non trova nessuno a quel prezzo lascerebbe
  // crediti in mano — e i crediti non spesi valgono zero.
  // L'avanzo resta **dentro il reparto**.
  //
  // Globale, faceva colare i crediti da un reparto all'altro: con la difesa che
  // non trovava nessuno alla sua cifra, l'attacco finiva a 222 crediti su una
  // quota di 165. La strategia dice anche quanto per reparto, e un avanzo non
  // e' una scusa per ignorarla.
  const avanzo = { P: 0, D: 0, C: 0, A: 0 } as RoleMap<number>;
  const quotaRuolo = { P: 0, D: 0, C: 0, A: 0 } as RoleMap<number>;
  const spesoRuolo = { P: 0, D: 0, C: 0, A: 0 } as RoleMap<number>;
  for (const g of gradini) quotaRuolo[g.role] += g.target;
  const scelti: Comprabile[] = [];
  /** Quanto il piano ha deciso di offrire per ognuno: puo' superare il prezzo di mercato. */
  const prezzi: number[] = [];
  for (const g of gradini) {
    if (liberi[g.role] <= 0) continue;
    const slotDopo = ROLES.reduce((a, r) => a + liberi[r], 0) - 1;
    const tettoCassa = Math.min(cassa, cassa - slotDopo);
    if (tettoCassa < 1) break;
    const tetto = Math.max(1, Math.min(tettoCassa, g.target + avanzo[g.role]));

    const lista = perRuolo.get(g.role) ?? [];
    const dentroIlGradino = lista.filter((c) => !usati.has(c.id) && c.prezzo <= tetto);
    /**
     * Il migliore che sta nel gradino — e "migliore" vuol dire **quanto rende
     * lo slot**, non quanto rende lui.
     *
     * Fra due giocatori allo stesso prezzo, uno che rende poco piu' ma che in
     * quattro si contendono vale meno di uno appena sotto che nessuno vuole: la
     * meta' delle volte il primo non ce l'hai. Ordinare per rendimento puro
     * ignorava proprio questo, ed e' il motivo per cui il piano si riempiva di
     * obiettivi al 25%.
     *
     * Siccome la probabilita' si muove a ogni chiamata registrata, questo
     * confronto si rifa' da solo mentre l'asta va avanti: un giocatore che si
     * libera perche' i suoi pretendenti hanno finito i crediti sale in cima da
     * solo.
     */
    const resaSlot = (c: Comprabile) => {
      const p = probabilitaA(c, c.prezzo);
      return p * c.expFM + (1 - p) * (ctx.replacementFM[c.role] - 0.2);
    };
    const migliore = dentroIlGradino.reduce<Comprabile | null>(
      (best, c) => (!best || resaSlot(c) > resaSlot(best) ? c : best),
      null,
    );
    const scelto =
      (migliore &&
        // ...ma senza pagare per niente: se a meta' prezzo c'e' uno che rende
        // praticamente uguale, i crediti risparmiati valgono piu' del decimale
        // di fantamedia, e li spende un altro gradino.
        dentroIlGradino
          .filter((c) => resaSlot(c) >= resaSlot(migliore) - EQUIVALENTI_RESA)
          .sort((a, b) => a.prezzo - b.prezzo)[0]) ??
      lista
        .filter((c) => !usati.has(c.id) && c.prezzo <= tettoCassa)
        .sort((a, b) => a.prezzo - b.prezzo)[0];
    if (!scelto) continue;

    avanzo[g.role] = Math.max(0, avanzo[g.role] + g.target - scelto.prezzo);
    cassa -= scelto.prezzo;
    spesoRuolo[scelto.role] += scelto.prezzo;
    liberi[scelto.role] -= 1;
    usati.add(scelto.id);
    scelti.push(scelto);
    prezzi.push(scelto.prezzo);
  }

  /**
   * I crediti che restano non restano.
   *
   * Un piano che si ferma a 492 su 500 non e' prudente, e' sbagliato: gli otto
   * crediti avanzati valgono zero a fine asta, e succede facilmente — basta una
   * scelta a mano che sposta la scala, o un acquisto registrato a un prezzo
   * diverso da quello previsto.
   *
   * Ci sono **due** modi di spenderli, e il software li confronta:
   *
   * - **salire di fascia**: al posto di quello che avevi in mente, uno che
   *   rende di piu' e costa quei crediti in piu';
   * - **comprare certezza**: lo stesso giocatore, offrendo sopra il tetto di
   *   uno o piu' avversari. Un obiettivo al 25% che diventa al 50% vale, in
   *   media, quanto mezzo giocatore in piu' — e all'asta e' la mossa che si fa
   *   davvero quando restano crediti e si vuole essere sicuri di uno.
   *
   * Si sceglie per **guadagno atteso per credito**, cosi' le due strade sono
   * confrontabili invece di essere due regole separate che si contraddicono.
   *
   * La quota del reparto vale ancora, con un margine: e' pensata per spendere
   * un residuo, non per rifare la rosa. Togliendola del tutto la passata
   * riversava centinaia di crediti sui portieri, perche' con la probabilita'
   * continua **ogni** giocatore ha un piccolo guadagno da un'offerta piu' alta,
   * e senza freno se li prende tutti.
   */
  /**
   * I prezzi a cui vale la pena provare a salire.
   *
   * Con una probabilita' continua non c'e' piu' "un credito sopra il suo
   * tetto": conviene provare qualche gradino attorno a ogni avversario, perche'
   * il guadagno per credito ha un massimo che non sta per forza sul tetto.
   */
  const sogliePerSalire = (c: Comprabile): number[] => {
    const out = new Set<number>();
    for (const r of c.rivali ?? []) {
      for (const d of [0, 1, 3, 6, 12]) out.add(Math.round(r.previsto + d));
      out.add(Math.round(r.possibile) + 1);
    }
    return [...out].filter((x) => x > 0).sort((a, b) => a - b);
  };

  const resa = (c: Comprabile, prezzo: number) => {
    const p = probabilitaA(c, prezzo);
    return p * c.expFM + (1 - p) * (ctx.replacementFM[c.role] - 0.2);
  };

  for (let giro = 0; giro < 15 && cassa > 0; giro++) {
    type Mossa = { i: number; c: Comprabile; prezzo: number; perCredito: number };
    let meglio: Mossa | null = null;
    const valuta = (m: Mossa) => {
      if (m.perCredito <= 0) return;
      if (!meglio || m.perCredito > meglio.perCredito) meglio = m;
    };

    for (let i = 0; i < scelti.length; i++) {
      const attuale = scelti[i];
      const prezzoOra = prezzi[i];
      const budget = prezzoOra + cassa;
      // Il margine sulla quota: quanto basta a spendere un residuo, non a
      // ribaltare la ripartizione.
      const margine = Math.max(10, quotaRuolo[attuale.role] * 0.15);
      const spazio = quotaRuolo[attuale.role] + margine - spesoRuolo[attuale.role] + prezzoOra;
      const resaOra = resa(attuale, prezzoOra);

      // 1. Salire di fascia.
      for (const c of perRuolo.get(attuale.role) ?? []) {
        if (usati.has(c.id) || c.prezzo > budget || c.prezzo > spazio) continue;
        const costo = c.prezzo - prezzoOra;
        if (costo <= 0) continue;
        valuta({ i, c, prezzo: c.prezzo, perCredito: (resa(c, c.prezzo) - resaOra) / costo });
        break; // la lista e' ordinata per rendimento: il primo che ci sta e' il migliore
      }

      // 2. Comprare certezza su quello che hai gia' scelto: basta superare il
      //    tetto del prossimo avversario, non di tutti.
      for (const soglia of sogliePerSalire(attuale)) {
        const offerta = soglia;
        if (offerta <= prezzoOra || offerta > budget || offerta > spazio) continue;
        const costo = offerta - prezzoOra;
        valuta({
          i,
          c: attuale,
          prezzo: offerta,
          perCredito: (resa(attuale, offerta) - resaOra) / costo,
        });
      }
    }

    if (!meglio) break;
    const m: Mossa = meglio;
    const vecchio = scelti[m.i];
    cassa -= m.prezzo - prezzi[m.i];
    spesoRuolo[vecchio.role] += m.prezzo - prezzi[m.i];
    if (m.c.id !== vecchio.id) {
      usati.delete(vecchio.id);
      usati.add(m.c.id);
      scelti[m.i] = m.c;
    }
    prezzi[m.i] = m.prezzo;
  }

  for (let i = 0; i < scelti.length; i++) {
    const scelto = scelti[i];
    const offerta = prezzi[i];
    // I concorrenti per questo slot: chi, nello stesso ruolo, costa piu' o meno
    // come lui. Se te lo soffiano, e' uno di questi che ti tocca.
    //
    // Il metro e' il prezzo di chi hai scelto, non la cassa che resta: legarlo
    // alla cassa faceva scendere il punteggio quando il piano **spendeva di
    // piu'**, che e' esattamente il contrario di quello che deve dire.
    const alternative = (perRuolo.get(scelto.role) ?? [])
      .filter((x) => !usati.has(x.id) && x.prezzo <= Math.max(2, offerta * 1.25))
      .slice(0, 6);
    const p = probabilitaA(scelto, offerta);
    // Quanto rende davvero lo slot: lui se lo prendi, il ripiego se te lo
    // soffiano. Offrire di piu' sposta questa media, ed e' il motivo per cui
    // comprare certezza e' una mossa e non un capriccio.
    const conRipiego = resaAttesa(alternative, ctx.replacementFM[scelto.role] - 0.2);
    dentro.push({
      role: scelto.role,
      expFM: p * scelto.expFM + (1 - p) * conRipiego,
      expMV: scelto.expMV,
      expApps: scelto.expApps,
    });
    presi.push({
      name: scelto.name,
      prezzo: offerta,
      probabilita: p,
      role: scelto.role,
    });
  }

  // Gli slot che restano si riempiono col livello di rimpiazzo: e' quello che
  // trovi comunque, ed e' gia' il metro con cui `puntiFormazione` conta i buchi.
  return { rosa: dentro, presi };
}

export type SlotIdeale = {
  role: Role;
  /** Il giocatore, se ce l'hai gia' in rosa. */
  preso: { name: string; prezzo: number } | null;
  /**
   * Il giocatore che hai messo tu nel piano, col prezzo che hai deciso tu.
   *
   * La probabilita' c'e' anche qui, e serve piu' che altrove: e' la risposta
   * alla domanda che uno si fa scegliendo un prezzo a mano — "a questa cifra me
   * lo lasciano?".
   */
  scelto: { playerId: string; name: string; prezzo: number; probabilita: number } | null;
  /** Chi il piano ci metterebbe, se lo slot e' ancora vuoto. */
  obiettivo: { name: string; prezzo: number; probabilita: number } | null;
  /** Titolare o panchina, secondo i moduli. */
  titolare: boolean;
};

export type RosaIdeale = {
  slots: SlotIdeale[];
  /** Punti a giornata attesi della formazione, se il piano va come dice. */
  punti: number;
  /** Crediti che il piano impegna, e quelli che restano. */
  impegnati: number;
  restano: number;
  /** Quanto rende, davvero, uno slot da un credito adesso. */
  valoreDiUnCredito: number;
};

/**
 * La rosa che stai costruendo: quello che hai, piu' quello che il piano prevede.
 *
 * Non e' una previsione dell'asta — nessuno sa chi verra' chiamato e quando — e'
 * **la fotografia del piano adesso**. Serve a vedere due cose che nei singoli
 * consigli non si vedono: dove sei scoperto, e come cambia la rosa possibile
 * mano a mano che i soldi girano. Quando un top va via a 250, questa cambia, e
 * il modo in cui cambia dice piu' di venti prezzi.
 */
export function rosaIdeale(args: {
  rosa: { role: Role; name: string; prezzo: number; expFM: number; expMV: number; expApps: number }[];
  slotsLiberi: RoleMap<number>;
  crediti: number;
  mercato: Comprabile[];
  ctx: ContestoFormazione;
  /** Quanto vuoi spendere su ogni gradino di ogni reparto: vedi `scalaPrezzi`. */
  scala?: RoleMap<number[]> | null;
  /**
   * I giocatori che hai deciso tu, con il prezzo che hai deciso tu.
   *
   * Entrano nel piano prima di ogni consiglio e non ne escono: il resto della
   * rosa si costruisce con quello che avanza. E' l'unico posto in cui il
   * software prende ordini invece di darli.
   */
  fissati?: {
    playerId: string;
    name: string;
    role: Role;
    prezzo: number;
    expFM: number;
    expMV: number;
    expApps: number;
    /** Che probabilita' hai di prenderlo a quel prezzo: la calcola il chiamante. */
    probabilita: number;
  }[];
}): RosaIdeale {
  const { rosa, slotsLiberi, crediti, mercato, ctx } = args;
  const inRosa: InRosa[] = rosa.map((r) => ({
    role: r.role,
    expFM: r.expFM,
    expMV: r.expMV,
    expApps: r.expApps,
  }));

  // Prima quello che hai deciso tu. Occupa slot e crediti, e non passa da
  // nessuna scelta del software: il piano si costruisce **intorno**.
  const fissati = (args.fissati ?? []).filter((f) => slotsLiberi[f.role] > 0);
  const slotsDopoFissati = { ...slotsLiberi };
  // I gradini che i fissati occupano escono dalla scala: quelli restanti sono
  // i gradini piu' bassi del reparto, che e' esattamente come funziona un'asta
  // — se hai gia' preso il tuo primo attaccante, quello che resta e' il secondo.
  const scalaDopoFissati: RoleMap<number[]> = { P: [], D: [], C: [], A: [] };
  for (const r of ROLES) scalaDopoFissati[r] = [...(args.scala?.[r] ?? [])];
  let creditiDopoFissati = crediti;
  const conFissati = [...inRosa];
  for (const f of fissati) {
    if (slotsDopoFissati[f.role] <= 0) continue;
    slotsDopoFissati[f.role] -= 1;
    creditiDopoFissati -= f.prezzo;
    scalaDopoFissati[f.role].shift();
    // Anche una scelta a mano puo' non arrivare: a un prezzo che i rivali
    // superano, quello slot vale il ripiego, non lui.
    const p = Math.max(0, Math.min(1, f.probabilita));
    conFissati.push({
      role: f.role,
      expFM: p * f.expFM + (1 - p) * (ctx.replacementFM[f.role] - 0.2),
      expMV: f.expMV,
      expApps: f.expApps,
    });
  }

  const fissatiIds = new Set(fissati.map((f) => f.playerId));
  const esito = riempi(
    conFissati,
    slotsDopoFissati,
    Math.max(0, creditiDopoFissati),
    mercato.filter((c) => !fissatiIds.has(c.id)),
    ctx,
    scalaDopoFissati,
  );
  const impegnati =
    esito.presi.reduce((a, p) => a + p.prezzo, 0) + fissati.reduce((a, f) => a + f.prezzo, 0);

  const slots: SlotIdeale[] = [];
  for (const r of ROLES) {
    const miei = rosa.filter((x) => x.role === r).sort((a, b) => b.expFM - a.expFM);
    const scelti = fissati.filter((f) => f.role === r);
    const obiettivi = esito.presi.filter((p) => p.role === r);
    const totali = miei.length + slotsLiberi[r];
    for (let i = 0; i < totali; i++) {
      const preso = miei[i] ?? null;
      const scelto = preso ? null : (scelti[i - miei.length] ?? null);
      const obiettivo =
        preso || scelto ? null : (obiettivi[i - miei.length - scelti.length] ?? null);
      slots.push({
        role: r,
        preso: preso ? { name: preso.name, prezzo: preso.prezzo } : null,
        scelto: scelto
          ? {
              playerId: scelto.playerId,
              name: scelto.name,
              prezzo: scelto.prezzo,
              probabilita: scelto.probabilita,
            }
          : null,
        obiettivo,
        titolare: i < Math.ceil(STARTERS_PER_TEAM[r]),
      });
    }
  }

  const aUnCredito = mercato
    .filter((c) => c.prezzo <= 1)
    .sort((a, b) => b.expFM - a.expFM)
    .slice(0, 8);

  return {
    slots,
    punti: Math.round(puntiFormazione(esito.rosa, ctx) * 100) / 100,
    impegnati,
    restano: Math.max(0, crediti - impegnati),
    valoreDiUnCredito:
      Math.round(
        resaAttesa(aUnCredito, Math.min(...ROLES.map((x) => ctx.replacementFM[x])) - 0.2) * 100,
      ) / 100,
  };
}

/** La scala del reparto senza il gradino piu' alto: l'ha appena occupato lui. */
function scalaSenzaPrimoGradino(
  scala: RoleMap<number[]> | null,
  role: Role,
): RoleMap<number[]> | null {
  if (!scala) return null;
  const out: RoleMap<number[]> = { P: [...scala.P], D: [...scala.D], C: [...scala.C], A: [...scala.A] };
  out[role] = out[role].slice(1);
  return out;
}

/**
 * Confronta le due strade: prenderlo a quel prezzo, o lasciarlo e spendere altrove.
 *
 * Il numero che conta e' il **pareggio**: il prezzo a cui le due strade rendono
 * uguale. Sotto conviene prenderlo, sopra conviene il piano B — e il piano B ha
 * un nome e un prezzo, non e' un'astrazione.
 */
export function pianifica(args: {
  rosa: InRosa[];
  slotsLiberi: RoleMap<number>;
  crediti: number;
  mercato: Comprabile[];
  candidato: Comprabile;
  ctx: ContestoFormazione;
  /** Quanto vuoi spendere su ogni gradino di ogni reparto: vedi `scalaPrezzi`. */
  scala?: RoleMap<number[]> | null;
}): Piano {
  const { rosa, slotsLiberi, crediti, mercato, candidato, ctx } = args;
  const scala = args.scala ?? null;
  const altri = mercato.filter((c) => c.id !== candidato.id);

  const senza = riempi(rosa, slotsLiberi, crediti, altri, ctx, scala);
  const senzaDiLui = puntiFormazione(senza.rosa, ctx);

  const valuta = (prezzo: number) => {
    if (prezzo > crediti) return -Infinity;
    const dopo = { ...slotsLiberi, [candidato.role]: slotsLiberi[candidato.role] - 1 };
    const conLui: InRosa[] = [
      ...rosa,
      {
        role: candidato.role,
        expFM: candidato.expFM,
        expMV: candidato.expMV,
        expApps: candidato.expApps,
      },
    ];
    // Il candidato occupa il gradino piu' alto del suo reparto: il resto del
    // piano deve vederlo, o comprerebbe due volte sullo stesso gradino.
    const scalaDopo = scalaSenzaPrimoGradino(scala, candidato.role);
    const resto = riempi(conLui, dopo, crediti - prezzo, altri, ctx, scalaDopo);
    return puntiFormazione(resto.rosa, ctx);
  };

  const conLui = valuta(candidato.prezzo);
  const resto = (() => {
    const dopo = { ...slotsLiberi, [candidato.role]: slotsLiberi[candidato.role] - 1 };
    const conLuiRosa: InRosa[] = [
      ...rosa,
      {
        role: candidato.role,
        expFM: candidato.expFM,
        expMV: candidato.expMV,
        expApps: candidato.expApps,
      },
    ];
    return riempi(
      conLuiRosa,
      dopo,
      Math.max(0, crediti - candidato.prezzo),
      altri,
      ctx,
      scalaSenzaPrimoGradino(scala, candidato.role),
    ).presi;
  })();

  // Il pareggio si cerca per bisezione: la funzione scende quando il prezzo
  // sale, quindi bastano una dozzina di passi.
  let lo = 1;
  let hi = Math.max(1, crediti);
  if (valuta(lo) <= senzaDiLui) {
    // Non conviene nemmeno a un credito: capita quando in quel ruolo hai gia'
    // di meglio di lui e ogni credito speso qui e' tolto a un altro reparto.
    hi = 1;
  } else if (valuta(hi) > senzaDiLui) {
    lo = hi;
  } else {
    for (let i = 0; i < 12; i++) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid === lo) break;
      if (valuta(mid) > senzaDiLui) lo = mid;
      else hi = mid;
    }
  }

  // Il termometro: quanto rende il migliore che si porta via un credito.
  // Il termometro del mercato: non "il migliore che costa un credito", ma
  // quanto rende davvero quello slot da un credito — che con tre avversari
  // ancora in caccia e' molto meno del primo della lista.
  const aUnCredito = mercato
    .filter((c) => c.prezzo <= 1)
    .sort((a, b) => b.expFM - a.expFM)
    .slice(0, 8);
  const valoreDiUnCredito = resaAttesa(
    aUnCredito,
    Math.min(...ROLES.map((r) => ctx.replacementFM[r])) - 0.2,
  );

  return {
    senzaDiLui: Math.round(senzaDiLui * 100) / 100,
    conLui: Math.round(conLui * 100) / 100,
    pareggio: lo,
    poi: resto.slice(0, 4),
    valoreDiUnCredito: Math.round(valoreDiUnCredito * 100) / 100,
  };
}

/**
 * Perche' quel giocatore, a quel prezzo, non ci sta nel piano.
 *
 * E' la stessa aritmetica che protegge la registrazione di un acquisto, un
 * livello prima: **anche un piano deve poter essere eseguito**. Se metti Kean a
 * 450 quando ti restano 455 crediti e ventiquattro slot, non hai pianificato
 * niente — hai scritto un numero che non puo' succedere.
 *
 * Il conto tiene dentro tutto insieme: quello che hai gia' speso e' fuori dai
 * crediti residui, le altre scelte a mano occupano i loro slot ai loro prezzi,
 * e ogni slot che resta vuole almeno un credito.
 */
export function perchePianoImpossibile(args: {
  /** I crediti che ti restano davvero, gia' al netto di quello che hai comprato. */
  crediti: number;
  /** Gli slot ancora da riempire, in tutti i ruoli. */
  slotsLiberi: number;
  /** Le scelte a mano gia' in piano, escluso il giocatore che stai aggiungendo. */
  altreScelte: number[];
  prezzo: number;
  nome: string;
}): string | null {
  const { crediti, slotsLiberi, altreScelte, prezzo, nome } = args;
  if (slotsLiberi <= 0) return "Non ti restano slot da riempire.";
  if (prezzo < 1) return "Il prezzo deve essere almeno 1.";

  const giaImpegnati = altreScelte.reduce((a, x) => a + x, 0);
  const slotAncoraVuoti = slotsLiberi - altreScelte.length - 1;
  if (slotAncoraVuoti < 0) return "Hai gia' scelto un giocatore per ogni slot libero.";

  // Un credito per ogni slot che resterebbe vuoto: senza, il piano promette una
  // rosa che non si puo' completare.
  const massimo = crediti - giaImpegnati - slotAncoraVuoti;
  if (prezzo > massimo)
    return (
      `Per ${nome} puoi arrivare a ${Math.max(0, massimo)}: ti restano ${crediti} crediti, ` +
      `${giaImpegnati > 0 ? `${giaImpegnati} li hai gia' impegnati in altre scelte, e ` : ""}` +
      `${slotAncoraVuoti} slot vogliono almeno un credito a testa.`
    );
  return null;
}
