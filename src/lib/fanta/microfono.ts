/**
 * Il microfono, spezzato in pezzi di parlato.
 *
 * Il riconoscimento del parlato lo fa gia' il browser, ma non dice **chi** ha
 * parlato e non da' accesso all'audio. Quindi il microfono va aperto una seconda
 * volta, in parallelo: uno stesso microfono puo' servire due lettori, e il costo
 * e' qualche percento di un core.
 *
 * Qui non si decide niente: si taglia il flusso dove c'e' silenzio e si consegna
 * l'impronta di ogni pezzo. Chi sia, lo decide `voce.ts`.
 */
import { FREQUENZA, coefficienti, energia, impronta } from "./voce";

export type Segmento = {
  impronta: Float32Array;
  /** Millisecondi, orologio della pagina: serve per legare il pezzo a cio' che diceva. */
  fine: number;
  durata: number;
  forza: number;
};

export type Microfono = {
  chiudi: () => void;
  /** Il livello attuale, 0..1, per la barretta a schermo. */
  livello: () => number;
};

const FINESTRA_MS = 100;
const SILENZIO_PER_CHIUDERE = 3; // 300 ms
const MAX_FINESTRE = 40; // 4 secondi: oltre e' un discorso, non una chiamata
const MIN_FINESTRE = 5; // mezzo secondo scarso: sotto, l'impronta e' rumore

/**
 * Apre il microfono e chiama `onSegmento` a ogni pezzo di parlato che finisce.
 *
 * I filtri del browser vanno spenti tutti e tre. Cancellazione d'eco,
 * soppressione del rumore e guadagno automatico servono a rendere una voce
 * comprensibile, e per farlo le tolgono proprio quello che la rende **quella**
 * voce: il guadagno automatico appiattisce le differenze di volume, la
 * soppressione del rumore lima le alte frequenze dove sta il timbro. Con quei
 * filtri accesi si finisce per riconoscere il microfono invece della persona.
 */
export async function apriMicrofono(opzioni: {
  onSegmento: (s: Segmento) => void;
  onErrore?: (e: string) => void;
}): Promise<Microfono> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  type ContestoAudio = typeof AudioContext;
  const Costruttore: ContestoAudio =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: ContestoAudio }).webkitAudioContext;
  // Chiedere direttamente 16 kHz evita di ricampionare a mano; se il browser non
  // sa accontentarci, si ricampiona sotto.
  let ctx: AudioContext;
  try {
    ctx = new Costruttore({ sampleRate: FREQUENZA });
  } catch {
    ctx = new Costruttore();
  }
  const sorgente = ctx.createMediaStreamSource(stream);
  const analisi = ctx.createAnalyser();
  analisi.fftSize = 4096;
  analisi.smoothingTimeConstant = 0;
  sorgente.connect(analisi);

  const buffer = new Float32Array(analisi.fftSize);
  const finestreCampioni = Math.round((FINESTRA_MS / 1000) * ctx.sampleRate);

  // Il fondo della stanza non e' noto e cambia: si impara dal piu' basso di
  // quello che si e' sentito finora, cosi' la soglia funziona sia in salotto
  // sia in un bar.
  let fondo = 0.01;
  let livelloAttuale = 0;
  let dentro: Float32Array[] = [];
  let silenzi = 0;

  const chiudiSegmento = () => {
    if (dentro.length >= MIN_FINESTRE) {
      let n = 0;
      for (const p of dentro) n += p.length;
      const tutto = new Float32Array(n);
      let off = 0;
      for (const p of dentro) {
        tutto.set(p, off);
        off += p.length;
      }
      const campioni = ctx.sampleRate === FREQUENZA ? tutto : ricampiona(tutto, ctx.sampleRate);
      const imp = impronta(coefficienti(campioni));
      if (imp) {
        opzioni.onSegmento({
          impronta: imp,
          fine: Date.now(),
          durata: campioni.length / FREQUENZA,
          forza: energia(campioni),
        });
      }
    }
    dentro = [];
    silenzi = 0;
  };

  const battito = setInterval(() => {
    analisi.getFloatTimeDomainData(buffer);
    const pezzo = buffer.slice(buffer.length - finestreCampioni);
    const e = energia(pezzo);
    livelloAttuale = Math.min(1, e * 8);

    fondo = e < fondo ? fondo * 0.9 + e * 0.1 : fondo * 0.999 + e * 0.001;
    const parla = e > Math.max(fondo * 3, 0.008);

    if (parla) {
      dentro.push(pezzo);
      silenzi = 0;
      if (dentro.length >= MAX_FINESTRE) chiudiSegmento();
    } else if (dentro.length > 0 && ++silenzi >= SILENZIO_PER_CHIUDERE) {
      chiudiSegmento();
    }
  }, FINESTRA_MS);

  return {
    chiudi: () => {
      clearInterval(battito);
      for (const t of stream.getTracks()) t.stop();
      void ctx.close();
    },
    livello: () => livelloAttuale,
  };
}

/** Ricampionamento lineare: basta, perche' poi si guarda solo sotto i 3800 Hz. */
function ricampiona(x: Float32Array, da: number): Float32Array {
  const rapporto = da / FREQUENZA;
  const n = Math.floor(x.length / rapporto);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rapporto;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = x[j] * (1 - f) + (x[j + 1] ?? x[j]) * f;
  }
  return out;
}
