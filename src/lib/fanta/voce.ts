/**
 * Riconoscere **chi** sta parlando, non cosa dice.
 *
 * All'asta il banditore non sempre dice a chi va: dice il nome, dice il prezzo, e
 * i rilanci arrivano dalla stanza. Sapere da quale voce arriva un rilancio vale
 * quanto sapere il prezzo, perche' dice chi ha ancora fame di quel ruolo.
 *
 * Qui non c'e' nessun modello scaricato: c'e' la catena classica del
 * riconoscimento del parlante — pre-enfasi, finestra, banco di filtri mel, DCT —
 * che produce dodici numeri per ogni venticinque millesimi di secondo. La firma
 * di una voce e' la media e la dispersione di quei numeri su tutto il pezzo
 * parlato. E' poco rispetto a una rete neurale, ma gira su un telefono, non
 * costa niente e non manda la voce di nessuno da nessuna parte.
 *
 * **Quanto ci si puo' fidare lo dice la prova, non questo commento**: le voci
 * vere, il microfono vero e il rumore vero della stanza cambiano tutto, e per
 * questo l'app misura da sola quanto ci prende (vedi `ProvaVoci`) invece di
 * dichiarare una precisione.
 */

/** Frequenza a cui lavora tutta la catena: la voce sta sotto agli 8 kHz. */
export const FREQUENZA = 16000;
const FINESTRA = 400; // 25 ms
const PASSO = 160; // 10 ms
const FFT = 512;
const N_FILTRI = 26;
const N_COEFF = 13; // il primo si butta: e' il volume, non la voce

// ---------------------------------------------------------------- FFT

/**
 * Trasformata di Fourier a base 2, sul posto.
 *
 * Serve solo lo spettro di potenza di una finestra di 512 campioni, quindi non
 * vale la pena di dipendere da una libreria: sono venti righe.
 */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// ---------------------------------------------------------------- banco mel

const inMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const daMel = (m: number) => 700 * (10 ** (m / 2595) - 1);

/**
 * Il banco di filtri triangolari, calcolato una volta sola.
 *
 * Da 300 a 3800 Hz: sotto c'e' il ronzio della stanza, sopra c'e' poco della
 * voce e molto del microfono. Restringere la banda e' il modo piu' economico di
 * non imparare il rumore invece della persona.
 */
const banco = (() => {
  const basso = inMel(300);
  const alto = inMel(3800);
  const punti = Array.from({ length: N_FILTRI + 2 }, (_, i) =>
    Math.floor(((FFT + 1) * daMel(basso + ((alto - basso) * i) / (N_FILTRI + 1))) / FREQUENZA),
  );
  const filtri: Float32Array[] = [];
  for (let m = 1; m <= N_FILTRI; m++) {
    const f = new Float32Array(FFT / 2 + 1);
    for (let k = punti[m - 1]; k < punti[m]; k++) f[k] = (k - punti[m - 1]) / (punti[m] - punti[m - 1] || 1);
    for (let k = punti[m]; k < punti[m + 1]; k++) f[k] = (punti[m + 1] - k) / (punti[m + 1] - punti[m] || 1);
    filtri.push(f);
  }
  return filtri;
})();

/** Coseni della DCT-II, anch'essi calcolati una volta sola. */
const coseni = (() => {
  const t: Float32Array[] = [];
  for (let c = 0; c < N_COEFF; c++) {
    const r = new Float32Array(N_FILTRI);
    for (let m = 0; m < N_FILTRI; m++) r[m] = Math.cos((Math.PI * c * (m + 0.5)) / N_FILTRI);
    t.push(r);
  }
  return t;
})();

const hamming = (() => {
  const w = new Float32Array(FINESTRA);
  for (let i = 0; i < FINESTRA; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FINESTRA - 1));
  return w;
})();

// ---------------------------------------------------------------- coefficienti

/**
 * I coefficienti cepstrali di un pezzo di audio, una riga ogni dieci millesimi.
 *
 * Il primo coefficiente non esce: dipende da quanto forte hai parlato e da
 * quanto eri vicino al microfono, cioe' proprio da quello che all'asta cambia
 * ogni volta.
 */
export function coefficienti(campioni: Float32Array): number[][] {
  const righe: number[][] = [];
  const re = new Float32Array(FFT);
  const im = new Float32Array(FFT);

  for (let off = 0; off + FINESTRA <= campioni.length; off += PASSO) {
    re.fill(0);
    im.fill(0);
    // pre-enfasi: alza le alte, dove sta il timbro, e toglie la componente continua
    let prec = campioni[off];
    for (let i = 0; i < FINESTRA; i++) {
      const x = campioni[off + i];
      re[i] = (x - 0.97 * prec) * hamming[i];
      prec = x;
    }
    fft(re, im);

    const energie = new Float32Array(N_FILTRI);
    for (let m = 0; m < N_FILTRI; m++) {
      let s = 0;
      const f = banco[m];
      for (let k = 0; k <= FFT / 2; k++) {
        if (f[k] === 0) continue;
        s += f[k] * (re[k] * re[k] + im[k] * im[k]);
      }
      energie[m] = Math.log(s + 1e-10);
    }

    const riga = new Array<number>(N_COEFF - 1);
    for (let c = 1; c < N_COEFF; c++) {
      let s = 0;
      const cs = coseni[c];
      for (let m = 0; m < N_FILTRI; m++) s += energie[m] * cs[m];
      riga[c - 1] = s;
    }
    righe.push(riga);
  }
  return righe;
}

/** Quanta energia c'e' in un pezzo: serve per capire se qualcuno sta parlando. */
export function energia(campioni: Float32Array): number {
  let s = 0;
  for (let i = 0; i < campioni.length; i++) s += campioni[i] * campioni[i];
  return Math.sqrt(s / Math.max(1, campioni.length));
}

// ---------------------------------------------------------------- impronta

/**
 * Provata e buttata: la sottrazione spettrale del rumore.
 *
 * L'idea era di stimare lo spettro della stanza dalle pause — il decimo
 * percentile di ogni banda dentro il pezzo parlato — e sottrarlo prima del
 * logaritmo. Misurata (`npm run check:voci`), peggiora quasi tutto: in stanza
 * molto rumorosa si scende dall'88% al 74%, e con voci che si somigliano gli
 * errori salgono dal 5% al 27%. Nemmeno rendendo adattiva la quantita' da
 * togliere il conto torna.
 *
 * Il motivo e' che il lavoro lo fa gia' il centraggio sulle voci della lega: il
 * rumore della stanza e' lo stesso per tutti, quindi finisce nella media delle
 * impronte e viene tolto li'. Sottrarlo una seconda volta prima del logaritmo
 * toglie anche il fondo spettrale di ciascuno, che invece **e'** informazione
 * sul parlante — in una registrazione pulita il decimo percentile di una banda
 * non e' rumore, e' quella voce nel suo momento piu' basso.
 */

/** Quante righe servono perche' un'impronta abbia senso: mezzo secondo. */
export const RIGHE_MINIME = 45;

/**
 * L'impronta di una voce: media e dispersione dei coefficienti.
 *
 * La media dice il timbro, la dispersione dice **come** si muove quella voce —
 * chi parla piatto e chi canta la frase hanno la stessa media e dispersioni
 * diverse. Tenere solo la media dimezzerebbe le informazioni utili.
 *
 * La media viene poi tolta dai coefficienti prima di misurarla (e' la
 * normalizzazione cepstrale): senza, si finisce per riconoscere il microfono e
 * la posizione nella stanza invece della persona, e l'impronta smette di valere
 * appena qualcuno sposta il telefono.
 */
export function impronta(righe: number[][]): Float32Array | null {
  if (righe.length < RIGHE_MINIME) return null;
  const d = righe[0].length;
  const media = new Float64Array(d);
  for (const r of righe) for (let i = 0; i < d; i++) media[i] += r[i];
  for (let i = 0; i < d; i++) media[i] /= righe.length;

  const varianza = new Float64Array(d);
  for (const r of righe) for (let i = 0; i < d; i++) varianza[i] += (r[i] - media[i]) ** 2;

  // Provati e buttati: i coefficienti delta, cioe' quanto in fretta si muovono
  // i cepstrali. Sulla carta portano informazione sul parlante e reggono meglio
  // al rumore, perche' una differenza fra due righe vicine si porta via tutto
  // cio' che e' costante. Misurati (`npm run check:voci`, 320 prove per riga),
  // non spostano niente: le percentuali restano identiche in tutte e sei le
  // condizioni. Il motivo e' probabilmente la scala — i delta sono un ordine di
  // grandezza sotto le medie, e dopo la normalizzazione pesano quasi zero — ma
  // il numero e' quello e la complicazione non si paga.

  const out = new Float32Array(d * 2);
  for (let i = 0; i < d; i++) {
    out[i] = media[i];
    out[d + i] = Math.sqrt(varianza[i] / righe.length);
  }
  return normalizza(out);
}

/**
 * Fonde piu' impronte in una sola.
 *
 * L'iscrizione raccoglie qualche secondo di parlato: fondere le impronte dei
 * pezzi e' meglio che tenerne una sola, perche' una singola frase puo' capitare
 * su un tono che quella persona non usa quasi mai.
 */
export function fondiImpronte(lista: Float32Array[]): Float32Array | null {
  if (lista.length === 0) return null;
  const out = new Float32Array(lista[0].length);
  for (const v of lista) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return normalizza(out);
}

function normalizza(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Quanto due impronte si somigliano: da -1 a 1, ma in pratica sopra lo zero. */
export function somiglianzaVoci(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

export type Profilo = {
  participantId: string;
  nome: string;
  impronta: number[];
  /**
   * Le due meta' della lettura, tenute a parte.
   *
   * Servono a una domanda che senza un testo letto non si poteva fare: **quanto
   * somiglia a se stessa, questa voce?** Se le due meta' della stessa lettura
   * non si somigliano, non c'e' nessuna soglia che possa salvare quella
   * iscrizione — ed e' anche il metro giusto per decidere quanto pretendere
   * dagli altri, perche' nessuno puo' somigliare a Marco piu' di quanto Marco
   * somigli a se stesso.
   */
  meta?: [number[], number[]];
};

export type Riconoscimento = {
  participantId: string;
  nome: string;
  /** Quanto somiglia al migliore, dopo il centraggio. */
  somiglianza: number;
  /** Quanto stacca il secondo: e' questo che dice se fidarsi. */
  margine: number;
};

/**
 * Il metro su cui misurare le voci di **questa** lega.
 *
 * Misurando si e' visto che due voci diverse si somigliano comunque allo 0.49 e
 * una voce alla propria impronta allo 0.99: quasi tutto il coseno e' occupato da
 * cio' che le voci umane hanno in comune, e le differenze stanno schiacciate in
 * cima. Togliendo a ogni impronta la media di tutte le impronte iscritte, quel
 * fondo comune sparisce e resta solo cio' che distingue una persona dalle altre
 * — che e' esattamente la domanda.
 *
 * L'asticella non e' una costante per lo stesso motivo: otto voci molto diverse
 * lasciano stacchi larghi, otto voci simili lasciano stacchi stretti, e
 * un'asticella fissa in un caso fa passare errori e nell'altro fa dire "non lo
 * so" sempre. Si ricava da quanto si somigliano le impronte iscritte.
 */
export type Metro = {
  centro: number[];
  minima: number;
  margine: number;
  /**
   * Quanto si somigliano, a due a due, le voci iscritte (gia' centrate).
   *
   * Serve perche' l'asticella giusta non e' una sola: dire "e' Marco e non
   * Luca" e' facile se Marco e Luca hanno voci diverse e impossibile se sono
   * fratelli. La coppia in ballo la si conosce solo al momento, quindi la
   * tabella se ne sta qui e l'asticella si calcola sulla coppia.
   */
  vicinanza: Record<string, number>;
  /**
   * Quanto una voce somiglia a se stessa, misurato sulle due meta' della
   * lettura. E' il tetto di quello che si puo' pretendere da un riconoscimento.
   */
  stabilita: number;
  /** 0..1: quanto sono distinguibili le voci iscritte. Sotto 0.15 e' dura. */
  separabilita: number;
};

const coppia = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Provata e buttata: pretendere che il primo posto arrivi vicino a quanto una
 * voce somiglia a se stessa.
 *
 * Sembrava il modo naturale di usare il numero che il testo letto rende
 * disponibile — nessuno puo' somigliare a Marco piu' di quanto Marco somigli a
 * se stesso — ma misurata (tabella "quanto pretendere" in
 * `scripts/voci-check.ts`) non sposta niente: dallo 0% all'80% della stabilita'
 * gli errori restano all'8%, e sopra si perdono solo riconoscimenti giusti. I
 * riconoscimenti sbagliati non sono quelli con un punteggio basso, sono quelli
 * in cui **due impronte sono davvero vicine**, e quello lo intercetta gia'
 * l'asticella sulla coppia.
 *
 * La stabilita' resta comunque misurata, ma per un'altra domanda, che vale piu'
 * di questa: se le due meta' di una lettura non si somigliano, quell'iscrizione
 * e' venuta male e va rifatta — e prima si dice, meglio e'.
 */

export function taraSullaLega(profili: Profilo[]): Metro {
  const d = profili[0]?.impronta.length ?? 0;
  const centro = new Array<number>(d).fill(0);
  for (const p of profili) for (let i = 0; i < d; i++) centro[i] += p.impronta[i] / profili.length;

  const centrate = profili.map((p) => centra(Float32Array.from(p.impronta), centro));
  const vicinanza: Record<string, number> = {};
  let vicina = -1;
  for (let i = 0; i < centrate.length; i++)
    for (let j = i + 1; j < centrate.length; j++) {
      const s = somiglianzaVoci(centrate[i], centrate[j]);
      vicinanza[coppia(profili[i].participantId, profili[j].participantId)] = s;
      vicina = Math.max(vicina, s);
    }

  // Quanto ciascuno somiglia a se stesso: la mediana, perche' basta uno che ha
  // letto male per tirare giu' una media.
  const stabilitaSingole = profili
    .map((p) =>
      p.meta
        ? somiglianzaVoci(
            centra(Float32Array.from(p.meta[0]), centro),
            centra(Float32Array.from(p.meta[1]), centro),
          )
        : null,
    )
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const stabilita = stabilitaSingole.length
    ? stabilitaSingole[Math.floor(stabilitaSingole.length / 2)]
    : 1;

  // Con una sola voce iscritta non c'e' niente da distinguere.
  if (profili.length < 2)
    return { centro, minima: 0.3, margine: 0.05, vicinanza, stabilita, separabilita: 0 };

  const separabilita = Math.max(0, Math.min(1, (1 - vicina) / 2));
  return {
    centro,
    // Sotto questa somiglianza non e' nessuno dei presenti: e' il banditore, o
    // un rumore. Con voci poco separabili va abbassata, o non scatta mai.
    minima: 0.15 + 0.25 * separabilita,
    /** Il minimo assoluto, quando la coppia in ballo non si conosce. */
    margine: Math.max(0.02, 0.35 * (1 - vicina)),
    vicinanza,
    stabilita,
    separabilita,
  };
}

/**
 * Quanto stacco serve per preferire una voce a un'altra.
 *
 * Se le due impronte iscritte sono lontane, basta poco: sono due persone che non
 * si somigliano, e il primo posto significa qualcosa. Se sono vicine, servono
 * prove molto piu' forti — e sopra una certa vicinanza non c'e' stacco che
 * basti, perche' l'informazione per distinguerle non c'e' proprio.
 */
function margineRichiesto(metro: Metro, a: string, b: string): number {
  const v = metro.vicinanza[coppia(a, b)];
  if (v == null) return metro.margine;
  // misurato in scripts/voci-check.ts: 0.35 dello spazio che la coppia lascia
  return Math.max(0.02, 0.35 * (1 - v));
}

function centra(v: Float32Array, centro: number[]): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - (centro[i] ?? 0);
  return normalizza(out);
}

/**
 * Chi ha parlato, se qualcuno.
 *
 * Il criterio non e' "somiglia a Marco" ma "somiglia a Marco **piu' che a
 * chiunque altro, e di parecchio**". Con otto persone nella stessa stanza il
 * primo punteggio e' alto per tutti: quello che distingue una voce riconosciuta
 * da una tirata a indovinare e' lo stacco dal secondo, misurato sul metro di
 * questa lega.
 *
 * Quando non e' sicuro non risponde. All'asta un "non lo so" costa un tocco;
 * un rilancio attribuito alla persona sbagliata falsa il budget di due squadre.
 */
export function chiHaParlato(
  voce: Float32Array,
  profili: Profilo[],
  metro: Metro,
): Riconoscimento | null {
  if (profili.length === 0) return null;
  const v = centra(voce, metro.centro);
  const punteggi = profili
    .map((p) => ({ p, s: somiglianzaVoci(v, centra(Float32Array.from(p.impronta), metro.centro)) }))
    .sort((a, b) => b.s - a.s);
  const primo = punteggi[0];
  const secondo = punteggi[1];
  const margine = secondo ? primo.s - secondo.s : primo.s;
  const richiesto = secondo
    ? margineRichiesto(metro, primo.p.participantId, secondo.p.participantId)
    : metro.margine;
  if (primo.s < metro.minima || margine < richiesto) return null;
  return {
    participantId: primo.p.participantId,
    nome: primo.p.nome,
    somiglianza: primo.s,
    margine,
  };
}
