/**
 * I numeri come li dice un banditore d'asta.
 *
 * "Duecentoquaranta" e' una parola sola, non tre: l'italiano attacca tutto, e
 * per giunta elide le vocali — venti piu' uno fa "ventuno", quaranta piu' otto
 * fa "quarantotto". Riconoscerli con una grammatica sarebbe piu' elegante e
 * molto piu' facile da sbagliare; visto che all'asta i numeri utili stanno fra
 * uno e qualche centinaio, si genera la tabella e si cerca dentro.
 *
 * I motori di riconoscimento vocale spesso restituiscono gia' le cifre ("240"),
 * ma non sempre e non tutti: vanno accettate entrambe le forme.
 */

const UNITA = [
  "zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove",
  "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici",
  "diciassette", "diciotto", "diciannove",
];

const DECINE: Record<number, string> = {
  2: "venti", 3: "trenta", 4: "quaranta", 5: "cinquanta",
  6: "sessanta", 7: "settanta", 8: "ottanta", 9: "novanta",
};

/**
 * Le forme in cui un numero puo' essere scritto.
 *
 * L'italiano elide la vocale finale davanti a un'altra vocale — venti piu' uno
 * fa "ventuno", cento piu' ottanta fa "centottanta" — ma non sempre e non in
 * modo uniforme ("centoundici" la tiene). Rincorrere l'ortografia esatta e' il
 * modo migliore per sbagliare un caso e non accorgersene: si generano
 * **entrambe** le forme e si accettano tutte e due. Due varianti dello stesso
 * numero non si contendono niente.
 */
function forme(testa: string, coda: string): string[] {
  const attaccate = testa + coda;
  const eliso = /^[aeiou]/.test(coda) ? testa.slice(0, -1) + coda : null;
  return eliso && eliso !== attaccate ? [attaccate, eliso] : [attaccate];
}

function inLettere(n: number): string[] {
  if (n < 20) return [UNITA[n]];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u === 0 ? [DECINE[d]] : forme(DECINE[d], UNITA[u]);
  }
  const centinaia = Math.floor(n / 100);
  const resto = n % 100;
  const testa = centinaia === 1 ? "cento" : `${UNITA[centinaia]}cento`;
  if (resto === 0) return [testa];
  return inLettere(resto).flatMap((coda) => forme(testa, coda));
}

/** Fin dove si generano: all'asta i prezzi non superano il budget di una squadra. */
const MASSIMO = 1000;

const PER_PAROLA = (() => {
  const m = new Map<string, number>();
  for (let n = 0; n <= MASSIMO; n++) {
    for (const forma of inLettere(n)) if (!m.has(forma)) m.set(forma, n);
  }
  return m;
})();

const pulisci = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/** Un numero da una parola sola: cifre o lettere. Niente se non lo e'. */
export function numeroItaliano(parola: string): number | null {
  const t = pulisci(parola);
  if (!t) return null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 0 && n <= MASSIMO ? n : null;
  }
  return PER_PAROLA.get(t) ?? null;
}

/**
 * Tutti i numeri di una frase, anche quando il motore vocale li spezza.
 *
 * "due cento quaranta" arriva a pezzi da alcuni motori: si prova prima a
 * unire le parole vicine, perche' 240 e' quasi sempre quello che intendeva
 * contro un 2 seguito da un 100 e da un 40.
 */
export function estraiNumeri(frase: string): number[] {
  const parole = frase.split(/[\s,.;:!?]+/).filter(Boolean);
  const out: number[] = [];
  let i = 0;
  while (i < parole.length) {
    // Prima la finestra piu' lunga: tre parole, poi due, poi una.
    let preso = false;
    for (let len = Math.min(3, parole.length - i); len >= 1 && !preso; len--) {
      const unite = parole.slice(i, i + len).join("");
      const n = numeroItaliano(unite);
      // Una finestra lunga vale solo se davvero compone un numero piu' grande:
      // "tre" e "otto" vicini non fanno 38 se erano due prezzi diversi.
      if (n != null && (len === 1 || n > 20)) {
        out.push(n);
        i += len;
        preso = true;
      }
    }
    if (!preso) i += 1;
  }
  return out;
}
