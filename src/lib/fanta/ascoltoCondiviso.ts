/**
 * Piu' microfoni nella stessa stanza.
 *
 * Se all'asta il software e' aperto su due o tre computer, ognuno sta ascoltando
 * la stessa voce da un punto diverso della stanza — e sente cose diverse. Il
 * banditore puo' essere limpido sul portatile in fondo e impastato su quello
 * vicino al ventilatore; chi rilancia seduto accanto a Marco e' fortissimo sul
 * computer di Marco e lontano su quello di Luca.
 *
 * Sono osservazioni **indipendenti dello stesso fatto**, ed e' esattamente la
 * situazione in cui metterle insieme vale piu' della somma: dove uno ha capito
 * il nome e l'altro il prezzo, insieme fanno una chiamata intera.
 *
 * Cosa viaggia e cosa no. Le impronte vocali **restano dove sono**: sono dati
 * personali, e per giunta sono tarate sul microfono di quel dispositivo, quindi
 * scambiarle peggiorerebbe il riconoscimento invece di migliorarlo. Viaggia
 * solo l'ipotesi gia' formata — "ho sentito Lautaro a 180, credo per Marco" —
 * che e' la stessa cosa che di li' a un secondo finira' comunque negli acquisti
 * registrati, visibili a tutti.
 */

export type Sentito = {
  /** Chi l'ha mandata: un identificativo del dispositivo, non della persona. */
  da: string;
  /** Come si chiama chi sta ascoltando da li', per poterlo dire a schermo. */
  chi: string;
  /** Orologio di chi ha mandato, in millisecondi. */
  quando: number;
  playerId: string | null;
  nomeGiocatore: string | null;
  prezzo: number | null;
  partecipanteId: string | null;
  nomePartecipante: string | null;
  /** 0..1, quanto quel dispositivo era sicuro del giocatore. */
  confidenza: number;
  /**
   * Quanto forte quel microfono ha sentito l'ultima voce.
   *
   * Non e' un dettaglio: chi ha sentito piu' forte era piu' vicino a chi
   * parlava, e sul **chi** — che e' la parte piu' fragile — vale piu' degli
   * altri. Sul nome e sul prezzo no: quelli li dice il banditore, che sta
   * lontano da tutti allo stesso modo.
   */
  forza: number;
};

/** Quanto puo' distare nel tempo un'osservazione perche' sia dello stesso fatto. */
export const FINESTRA_MS = 8000;

export type Fusione = {
  playerId: string | null;
  nomeGiocatore: string | null;
  prezzo: number | null;
  partecipanteId: string | null;
  nomePartecipante: string | null;
  /** Quanti dispositivi hanno contribuito, incluso il nostro. */
  dispositivi: number;
  /** Su cosa gli altri hanno aggiunto qualcosa che noi non avevamo. */
  aggiunto: ("giocatore" | "prezzo" | "acquirente")[];
  /** Chi era d'accordo sul giocatore, per poterlo dire. */
  concordi: string[];
};

type Voto<T> = { valore: T; peso: number; da: string };

function vinceIlPiuVotato<T>(voti: Voto<T>[]): { valore: T; peso: number; da: string[] } | null {
  const somme = new Map<string, { valore: T; peso: number; da: string[] }>();
  for (const v of voti) {
    const k = JSON.stringify(v.valore);
    const acc = somme.get(k) ?? { valore: v.valore, peso: 0, da: [] };
    acc.peso += v.peso;
    acc.da.push(v.da);
    somme.set(k, acc);
  }
  let migliore: { valore: T; peso: number; da: string[] } | null = null;
  for (const s of somme.values()) if (!migliore || s.peso > migliore.peso) migliore = s;
  return migliore;
}

/**
 * Mette insieme quello che hanno sentito tutti.
 *
 * Ogni campo si decide da solo, e con un peso diverso, perche' i tre campi non
 * hanno la stessa natura:
 *
 * - il **giocatore** lo dice il banditore: vince il piu' votato, pesando quanto
 *   ciascuno era sicuro;
 * - il **prezzo** in un'asta puo' solo salire, quindi fra chi e' d'accordo sul
 *   giocatore vince il piu' alto — un dispositivo che ha perso l'ultimo
 *   rilancio ha semplicemente sentito meno, non ha sentito un'altra cosa;
 * - l'**acquirente** e' la parte piu' fragile e la piu' locale: vince il piu'
 *   votato pesando **quanto forte** ciascuno ha sentito, perche' chi era vicino
 *   a chi ha alzato la mano ha visto la scena, gli altri l'hanno intuita.
 */
export function fondi(nostro: Sentito, altrui: Sentito[]): Fusione {
  const validi = altrui.filter(
    (s) => s.da !== nostro.da && Math.abs(s.quando - nostro.quando) <= FINESTRA_MS,
  );
  const tutti = [nostro, ...validi];

  const perGiocatore = vinceIlPiuVotato(
    tutti
      .filter((s) => s.playerId)
      .map((s) => ({ valore: s.playerId!, peso: Math.max(0.1, s.confidenza), da: s.da })),
  );
  const playerId = perGiocatore?.valore ?? null;
  const suLui = tutti.filter((s) => s.playerId === playerId);
  const nomeGiocatore =
    suLui.find((s) => s.nomeGiocatore)?.nomeGiocatore ?? nostro.nomeGiocatore ?? null;

  const prezzi = (playerId ? suLui : tutti).map((s) => s.prezzo).filter((p): p is number => p != null);
  const prezzo = prezzi.length > 0 ? Math.max(...prezzi) : null;

  // L'acquirente si decide a maggioranza semplice, con il volume solo come
  // spareggio. Pesarlo per quanto forte ciascuno aveva sentito sembrava
  // ovvio — chi era vicino a chi ha alzato la mano ha visto la scena — ma
  // misurato (`npm run check:ascolto`) **peggiorava**: dall'81% al 74% con tre
  // dispositivi, perche' un microfono che sente forte e capisce male vince
  // comunque il voto. Che il volume dica qualcosa sulla verita' resta una
  // supposizione, e qui non se ne tiene conto piu' di tanto.
  const perAcquirente = vinceIlPiuVotato(
    tutti
      .filter((s) => s.partecipanteId)
      .map((s) => ({ valore: s.partecipanteId!, peso: 1 + 0.05 * s.forza, da: s.da })),
  );
  const partecipanteId = perAcquirente?.valore ?? null;
  const nomePartecipante =
    tutti.find((s) => s.partecipanteId === partecipanteId)?.nomePartecipante ?? null;

  const aggiunto: Fusione["aggiunto"] = [];
  if (!nostro.playerId && playerId) aggiunto.push("giocatore");
  if (nostro.prezzo == null && prezzo != null) aggiunto.push("prezzo");
  if (!nostro.partecipanteId && partecipanteId) aggiunto.push("acquirente");

  return {
    playerId,
    nomeGiocatore,
    prezzo,
    partecipanteId,
    nomePartecipante,
    dispositivi: tutti.length,
    aggiunto,
    concordi: [...new Set(suLui.map((s) => s.chi))],
  };
}
