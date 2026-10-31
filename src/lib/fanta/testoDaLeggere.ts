/**
 * Il testo che si legge per farsi riconoscere la voce.
 *
 * Non e' una frase qualsiasi. L'impronta di una voce e' media e dispersione dei
 * coefficienti **su cio' che si e' pronunciato**: chi all'iscrizione dice due
 * vocali ha mappato due vocali, e all'asta ne usa sette. Qui dentro ci sono
 * tutte e sette le vocali, le occlusive sorde e sonore, le fricative, le
 * affricate, le nasali, la laterale, la palatale, la vibrante e le doppie.
 *
 * Ed e' **uguale per tutti**, che e' la meta' del guadagno: se ognuno dice una
 * cosa diversa, una parte della distanza fra due impronte non e' la differenza
 * fra le due persone ma la differenza fra le due frasi. Misurato su voci
 * sintetiche (`npm run check:voci`), leggendo lo stesso testo si passa dal 79%
 * all'84% di riconoscimenti giusti e dal 3% all'1% di sbagliati, con lo stacco
 * fra la propria impronta e quella degli altri che sale da 0.863 a 0.916.
 *
 * Le parole sono quelle dell'asta di proposito — numeri, ruoli, "aggiudicato" —
 * perche' sono quelle che quella persona dira' davvero.
 */
export const TESTO_DA_LEGGERE =
  "Quest'anno il portiere lo prendo per ultimo. Aggiudicato: cinquanta al Milan, " +
  "sessantatré alla Juve, e il prezzo sale ancora. Gli attaccanti che segnano ogni " +
  "domenica costano uno sproposito; chi sbaglia guarda la classifica da sotto, con " +
  "zero soddisfazioni. Voglio un centrocampista che gioca sempre e non si fa male a ottobre.";

/** Quanto ci mette una persona a leggerlo con calma. */
export const SECONDI_LETTURA = 20;

/**
 * Quanto deve somigliare, quello che il browser ha sentito, al testo atteso.
 *
 * Non serve che sia giusto: il riconoscimento del parlato sbaglia parole in
 * continuazione e non e' quello il punto. Serve solo a distinguere "l'ha letto"
 * da "ha borbottato" o "il microfono non lo sente" — e quella distinzione
 * regge anche con una trascrizione mediocre.
 */
export const SOMIGLIANZA_MINIMA = 0.45;
