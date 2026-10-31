/**
 * Quanto rende la rosa che stai costruendo, non i giocatori che contiene.
 *
 * Il prezzo di un giocatore lo decide il mercato, e il motore lo calcola contro
 * un rimpiazzo teorico uguale per tutti. Ma **quanto vale per te** dipende da
 * cosa hai gia': il quarto attaccante buono vale meno del primo, perche' in
 * campo ne schieri tre; il secondo portiere della stessa squadra vale quasi
 * niente, perche' di portieri se ne schiera uno.
 *
 * Qui si calcola la cosa che conta davvero — i punti attesi della formazione
 * che scenderesti in campo — e per differenza quanto un giocatore ci aggiunge.
 * E' la stessa misura con cui `check:asta` decide chi ha fatto l'asta migliore,
 * quindi consigliare su questa vuol dire consigliare sulla cosa su cui poi si
 * viene giudicati.
 */
import { ROLES, STARTERS_PER_TEAM, type Role, type RoleMap } from "./types";

export type InRosa = {
  role: Role;
  /** Fantamedia attesa **senza** il bonus del modificatore: quello si calcola sulla linea. */
  expFM: number;
  /** Media voto attesa: serve solo a portiere e difensori, per il modificatore. */
  expMV: number;
  expApps: number;
};

export type ContestoFormazione = {
  replacementFM: RoleMap<number>;
  replacementMV: RoleMap<number>;
  /** Il modificatore di difesa e' attivo in questa lega? */
  modificatore: boolean;
};

/**
 * Quanto vale il modificatore di difesa, data la media voto della linea.
 *
 * Sulla scala di Fantacalcio.it il bonus va da -1 con una media di 5.5 a +3 con
 * una di 6.5 e +5 con una di 7: quattro fantapunti per ogni punto di media, e
 * **lineare** nell'intervallo in cui si gioca davvero. Non c'e' nessuno scalino
 * da inseguire, e per questo la correlazione fra compagni di reparto non sposta
 * il valore atteso: una funzione lineare della media non guarda la varianza.
 *
 * Quello che invece conta, e che il prezzo per giocatore non poteva vedere, e'
 * che la media si fa **sulla linea che schieri**: un difensore da 6.4 vale molto
 * se ti tira su una difesa da 5.9 e quasi niente se la tua linea sta gia' a 6.5
 * e lui sarebbe il quarto.
 */
export const PENDENZA_MODIFICATORE = 4;
const CENTRO_MODIFICATORE = 6;

export function bonusModificatore(mediaLinea: number): number {
  return (mediaLinea - CENTRO_MODIFICATORE) * PENDENZA_MODIFICATORE;
}

/**
 * Quanti punti a giornata rende la formazione titolare di questa rosa.
 *
 * Gli slot da titolare per ruolo sono frazionari — 3.6 difensori, 4.2
 * centrocampisti — perche' sono la media fra i moduli ammessi: troncare
 * butterebbe via il titolare parziale, che e' proprio quello che distingue chi
 * ha la rosa profonda.
 *
 * E chi non gioca non porta punti: un titolare da 8 che scende in campo meta'
 * delle volte rende meno di un 6.5 che c'e' sempre, e quando manca il suo posto
 * lo prende un rimpiazzo — che vale un filo meno del livello di rimpiazzo, per
 * il fastidio di doverlo cercare.
 */
export function puntiFormazione(rosa: InRosa[], ctx: ContestoFormazione): number {
  let tot = 0;
  // La linea che finisce sotto il modificatore: portiere e difensori schierati,
  // ciascuno col peso con cui scende in campo.
  let pesoLinea = 0;
  let sommaMV = 0;

  for (const r of ROLES) {
    const ordinati = rosa.filter((p) => p.role === r).sort((a, b) => b.expFM - a.expFM);
    let restano = STARTERS_PER_TEAM[r];
    const ripiegoFM = ctx.replacementFM[r] - 0.2;
    const ripiegoMV = ctx.replacementMV[r];
    const contaPerModificatore = ctx.modificatore && (r === "P" || r === "D");

    for (const p of ordinati) {
      if (restano <= 0) break;
      const peso = Math.min(1, restano);
      const disponibilita = Math.min(1, Math.max(0, p.expApps / 34));
      tot += peso * (disponibilita * p.expFM + (1 - disponibilita) * ripiegoFM);
      if (contaPerModificatore) {
        pesoLinea += peso;
        sommaMV += peso * (disponibilita * p.expMV + (1 - disponibilita) * ripiegoMV);
      }
      restano -= 1;
    }
    if (restano > 0) {
      tot += restano * ripiegoFM;
      if (contaPerModificatore) {
        pesoLinea += restano;
        sommaMV += restano * ripiegoMV;
      }
    }
  }

  // Il modificatore non e' un bonus per giocatore: e' uno solo, sulla media
  // della linea. Sommarlo per giocatore, come faceva il prezzo, funziona finche'
  // si guarda un giocatore alla volta, ma non sa dire quanto **quel** difensore
  // sposta **la tua** difesa.
  if (ctx.modificatore && pesoLinea > 0) tot += bonusModificatore(sommaMV / pesoLinea);
  return tot;
}

/**
 * Quanto questo giocatore aggiunge alla tua formazione, in punti a giornata.
 *
 * Zero non vuol dire che e' scarso: vuol dire che **a te** non serve, perche'
 * in quel ruolo hai gia' di meglio quante volte scendi in campo. E' la
 * differenza fra "quanto vale" e "quanto ti conviene", che all'asta e' tutto.
 */
export function contributoMarginale(
  rosa: InRosa[],
  candidato: InRosa,
  ctx: ContestoFormazione,
): number {
  return puntiFormazione([...rosa, candidato], ctx) - puntiFormazione(rosa, ctx);
}

/** La media voto della difesa che schiereresti: e' quella che decide il modificatore. */
export function mediaDifesa(rosa: InRosa[], ctx: ContestoFormazione): number {
  let peso = 0;
  let somma = 0;
  for (const r of ["P", "D"] as const) {
    const ordinati = rosa.filter((p) => p.role === r).sort((a, b) => b.expFM - a.expFM);
    let restano = STARTERS_PER_TEAM[r];
    for (const p of ordinati) {
      if (restano <= 0) break;
      const q = Math.min(1, restano);
      const disponibilita = Math.min(1, Math.max(0, p.expApps / 34));
      peso += q;
      somma += q * (disponibilita * p.expMV + (1 - disponibilita) * ctx.replacementMV[r]);
      restano -= 1;
    }
    if (restano > 0) {
      peso += restano;
      somma += restano * ctx.replacementMV[r];
    }
  }
  return peso > 0 ? somma / peso : 0;
}

/**
 * Quanto varrebbe il primo giocatore di quel livello, in una rosa vuota.
 *
 * Serve come metro: un contributo di 0.3 punti e' tanto o poco? Dipende da cosa
 * avrebbe dato se fosse arrivato per primo. Il rapporto fra i due dice quanta
 * parte del suo valore stai davvero comprando.
 */
export function contributoDaSolo(candidato: InRosa, ctx: ContestoFormazione): number {
  return contributoMarginale([], candidato, ctx);
}
