/**
 * Chi mettere nella lista dei chiamabili.
 *
 * La domanda non e' "chi sono i piu' forti": e' **quale insieme di giocatori fa
 * un'asta che funziona**. Sono due cose diverse, e la seconda ha vincoli che la
 * prima ignora del tutto.
 *
 * 1. **Ogni squadra deve poter chiudere la rosa.** Otto squadre da tre portieri
 *    vogliono ventiquattro portieri chiamabili: se ne metti venti, quattro
 *    squadre finiscono l'asta con una casella vuota e la lega si ferma a
 *    discutere invece di giocare.
 * 2. **La lista deve essere pagabile.** Otto squadre da cinquecento crediti
 *    hanno quattromila crediti in tutto. Se i duecento nomi scelti valgono
 *    seimila, i conti non tornano: qualcuno restera' senza. Se ne valgono
 *    milleduecento, l'asta finisce con le tasche piene e il gioco e' un altro.
 * 3. **Servono i riempitivi.** Nessuno completa venticinque caselle con soli
 *    titolari: la meta' bassa di ogni rosa sono giocatori da uno o due crediti,
 *    e una lista fatta dei soli migliori non si puo' comprare.
 *
 * Per questo l'ordine non e' il valore del modello ma la **resa attesa dello
 * slot** — quanto quel giocatore rende davvero a chi se lo mette in formazione,
 * cioe' la fantamedia pesata per quante partite giochera' — e sopra ci stanno
 * tre quote: i titolari, i ricambi, i riempitivi.
 */
import type { Comprabile } from "./piano";
import { ROLES, STARTERS_PER_TEAM, type Role, type RoleMap } from "./types";

export type CandidatoLista = Comprabile & {
  team: string;
  quotazione: number;
  valore: number;
};

export type QuoteLista = {
  /** Quanti ne servono per riempire tutte le rose. */
  necessari: number;
  /** Quanti in piu' se ne mettono, perche' una lista al minimo non regge. */
  extra: number;
  /** Di questi, quanti devono costare pochissimo: sono le caselle finali. */
  riempitivi: number;
};

/**
 * Un giocatore vale per la lista quanto rende in formazione.
 *
 * `expFM` da sola sbaglia in due modi opposti: premia chi ha una media alta e
 * dieci presenze, e non distingue un portiere da un attaccante — ma il portiere
 * lo schieri sempre e il quarto attaccante quasi mai. Il peso di ruolo
 * (`STARTERS_PER_TEAM`) e' lo stesso che il motore usa per i punti a giornata.
 */
export function resaAttesa(c: { expFM: number; expApps: number; role: Role }): number {
  const quotaPresenze = Math.min(1, Math.max(0, c.expApps) / 34);
  return c.expFM * quotaPresenze * (STARTERS_PER_TEAM[c.role] / STARTERS_PER_TEAM.C);
}

/**
 * Le quote per ruolo: necessari, extra, riempitivi.
 *
 * Gli extra non sono un vezzo. Una lista che contiene esattamente i giocatori
 * che servono e' un'asta senza scelte: ogni squadra prende quello che avanza, e
 * il prezzo lo fa il caso. Con un margine, invece, chi perde un obiettivo ha
 * dove ripiegare — ed e' quello che rende un'asta una gara.
 */
export function quotePerRuolo(
  slots: RoleMap<number>,
  squadre: number,
  extraPct: number,
): RoleMap<QuoteLista> {
  const out = {} as RoleMap<QuoteLista>;
  for (const r of ROLES) {
    const necessari = (slots[r] ?? 0) * Math.max(1, squadre);
    const extra = Math.round(necessari * Math.max(0, extraPct));
    // Le caselle oltre i titolari: quelle si chiudono a un credito, e qualcuno
    // deve pur esserci. Una squadra per casella rimasta.
    const panchina = Math.max(0, (slots[r] ?? 0) - Math.round(STARTERS_PER_TEAM[r]));
    out[r] = { necessari, extra, riempitivi: panchina * Math.max(1, squadre) };
  }
  return out;
}

export type EsitoLista = {
  scelti: CandidatoLista[];
  perRuolo: RoleMap<{ quote: QuoteLista; scelti: number }>;
  /** Quanto costerebbe comprare tutta la lista ai prezzi attesi. */
  spesaAttesa: number;
  /** I crediti che la lega ha in tutto. */
  creditiInGioco: number;
  note: string[];
};

/**
 * La lista proposta.
 *
 * Prima i migliori per resa fino a coprire necessari + extra; poi, se in quella
 * fascia i giocatori da pochi crediti non bastano a chiudere le rose, si
 * aggiungono i piu' utili fra quelli che costano poco. L'ordine conta: si parte
 * da chi fa vincere, non da chi riempie.
 */
export function proponiLista(args: {
  candidati: CandidatoLista[];
  slots: RoleMap<number>;
  squadre: number;
  crediti: number;
  extraPct: number;
}): EsitoLista {
  const { candidati, slots, squadre, crediti, extraPct } = args;
  const quote = quotePerRuolo(slots, squadre, extraPct);
  const scelti: CandidatoLista[] = [];
  const perRuolo = {} as RoleMap<{ quote: QuoteLista; scelti: number }>;
  const note: string[] = [];

  for (const r of ROLES) {
    const q = quote[r];
    const dellaFascia = candidati
      .filter((c) => c.role === r)
      .sort((a, b) => resaAttesa(b) - resaAttesa(a));

    const presi = dellaFascia.slice(0, q.necessari + q.extra);
    const dentro = new Set(presi.map((c) => c.id));

    // I riempitivi: chi chiude le caselle finali senza pesare sul budget. Si
    // contano quelli che gia' ci sono, e si aggiungono i mancanti pescando fra
    // i piu' utili sotto i tre crediti — che non e' "i peggiori": fra due
    // giocatori da un credito, uno gioca venti partite e l'altro nessuna.
    const economici = presi.filter((c) => c.prezzo <= 3).length;
    if (economici < q.riempitivi) {
      const aggiunti = dellaFascia
        .filter((c) => !dentro.has(c.id) && c.prezzo <= 3)
        .slice(0, q.riempitivi - economici);
      for (const c of aggiunti) {
        presi.push(c);
        dentro.add(c.id);
      }
      if (aggiunti.length > 0) {
        note.push(
          `${aggiunti.length} giocatori da pochi crediti aggiunti fra i ${nomeRuolo(r)}: senza, le ultime caselle delle rose non si chiuderebbero.`,
        );
      }
    }

    scelti.push(...presi);
    perRuolo[r] = { quote: q, scelti: presi.length };
  }

  const spesaAttesa = scelti.reduce((a, c) => a + c.prezzo, 0);
  const creditiInGioco = crediti * Math.max(1, squadre);
  if (spesaAttesa < creditiInGioco * 0.9) {
    note.push(
      `Ai prezzi attesi la lista vale ${spesaAttesa} crediti contro i ${creditiInGioco} in gioco: con cosi' pochi nomi i prezzi saliranno parecchio sopra le stime.`,
    );
  }
  if (spesaAttesa > creditiInGioco * 2.2) {
    note.push(
      `Ai prezzi attesi la lista vale ${spesaAttesa} crediti contro i ${creditiInGioco} in gioco: ce n'e' in abbondanza, molti resteranno invenduti.`,
    );
  }
  return { scelti, perRuolo, spesaAttesa, creditiInGioco, note };
}

const nomeRuolo = (r: Role) =>
  r === "P" ? "portieri" : r === "D" ? "difensori" : r === "C" ? "centrocampisti" : "attaccanti";
