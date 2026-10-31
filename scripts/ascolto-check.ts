/**
 * Mettere insieme quello che hanno sentito piu' computer, conviene?
 *
 * Qui non si misura quanto ci prende un microfono vero in una stanza vera —
 * quello dipende dalla stanza. Si misura **la regola di fusione**: dati due o
 * tre dispositivi che sbagliano in modo indipendente, metterli insieme migliora
 * o peggiora? Una regola scritta male puo' benissimo peggiorare, per esempio se
 * un dispositivo sicuro e sbagliato trascina gli altri.
 *
 * Le probabilita' di errore non sono misurate sul campo e non pretendono di
 * esserlo: sono i tre casi che contano — uno buono, uno mediocre, uno pessimo —
 * e la domanda e' se la regola estrae il vantaggio che l'indipendenza mette a
 * disposizione.
 */
import { fondi, type Sentito } from "../src/lib/fanta/ascoltoCondiviso";

let seme = 424242;
const caso = () => {
  seme = (seme * 1103515245 + 12345) & 0x7fffffff;
  return seme / 0x7fffffff;
};

type Qualita = { nome: string; giusto: number };

/**
 * Un dispositivo che ascolta una chiamata vera e ne riporta la sua versione.
 *
 * Quando sbaglia il nome non inventa a caso: sbaglia con un altro nome
 * plausibile, che e' il modo in cui sbaglia davvero il riconoscimento del
 * parlato. E quando non ha sentito, non sente **niente** invece di indovinare:
 * anche questo e' il comportamento vero, ed e' quello che rende utile fondere.
 */
function ascolta(vero: { p: string; prezzo: number; chi: string }, q: Qualita, da: string): Sentito {
  const prendi = <T,>(giusto: T, sbagliato: T): T | null => {
    const r = caso();
    if (r < q.giusto) return giusto;
    // meta' delle volte che non lo prende, non ha proprio sentito
    if (r < q.giusto + (1 - q.giusto) / 2) return null;
    return sbagliato;
  };
  const playerId = prendi(vero.p, `sbagliato-${Math.floor(caso() * 5)}`);
  const partecipanteId = prendi(vero.chi, `altro-${Math.floor(caso() * 4)}`);
  // Il prezzo, quando si sbaglia, si sbaglia per difetto: si perde un rilancio.
  const prezzoVisto = prendi(vero.prezzo, vero.prezzo - 10 - Math.floor(caso() * 20));
  return {
    da,
    chi: da,
    quando: Date.now(),
    playerId,
    nomeGiocatore: playerId,
    prezzo: prezzoVisto,
    partecipanteId,
    nomePartecipante: partecipanteId,
    // Chi ha capito e' anche piu' sicuro, ma non sempre: e' proprio l'errore
    // sicuro di se' quello che puo' rovinare una fusione.
    confidenza: playerId === vero.p ? 0.55 + caso() * 0.4 : 0.3 + caso() * 0.5,
    forza: 0.2 + caso() * 0.8,
  };
}

const QUALITA: Qualita[] = [
  { nome: "postazione buona", giusto: 0.8 },
  { nome: "postazione media", giusto: 0.6 },
  { nome: "postazione pessima", giusto: 0.4 },
];

function prova(quante: number, quali: Qualita[], volte = 4000) {
  const soloNostro = { p: 0, pr: 0, chi: 0, tutto: 0 };
  const fuso = { p: 0, pr: 0, chi: 0, tutto: 0 };
  for (let k = 0; k < volte; k++) {
    const vero = {
      p: `giocatore-${Math.floor(caso() * 500)}`,
      prezzo: 20 + Math.floor(caso() * 200),
      chi: `squadra-${Math.floor(caso() * 8)}`,
    };
    const sentiti = Array.from({ length: quante }, (_, i) =>
      ascolta(vero, quali[i % quali.length], `d${i}`),
    );
    const nostro = sentiti[0];
    const f = fondi(nostro, sentiti.slice(1));

    const conta = (acc: typeof soloNostro, p: unknown, pr: unknown, chi: unknown) => {
      const a = p === vero.p;
      const b = pr === vero.prezzo;
      const c = chi === vero.chi;
      if (a) acc.p++;
      if (b) acc.pr++;
      if (c) acc.chi++;
      if (a && b && c) acc.tutto++;
    };
    conta(soloNostro, nostro.playerId, nostro.prezzo, nostro.partecipanteId);
    conta(fuso, f.playerId, f.prezzo, f.partecipanteId);
  }
  const pc = (x: number) => `${((100 * x) / volte).toFixed(0)}%`.padStart(5);
  console.log(
    `  ${`${quante} computer`.padEnd(14)} giocatore ${pc(fuso.p)} (da solo ${pc(soloNostro.p)})   ` +
      `prezzo ${pc(fuso.pr)} (${pc(soloNostro.pr)})   chi ${pc(fuso.chi)} (${pc(soloNostro.chi)})   ` +
      `tutta la chiamata ${pc(fuso.tutto)} (${pc(soloNostro.tutto)})`,
  );
  return { soloNostro, fuso, volte };
}

console.log("\nTre postazioni diverse nella stessa stanza (la prima e' la nostra).\n");
const uno = prova(1, QUALITA);
const due = prova(2, QUALITA);
const tre = prova(3, QUALITA);
const quattro = prova(4, QUALITA);

console.log("\nE se la nostra postazione e' la peggiore?\n");
const capovolto = [...QUALITA].reverse();
prova(1, capovolto);
prova(3, capovolto);

let bad = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${l}`, ok ? "" : (d ?? ""));
  if (!ok) bad++;
};
console.log();
check("con un solo computer fondere non cambia niente", uno.fuso.tutto === uno.soloNostro.tutto);
check("con due si sente meglio che da soli", due.fuso.tutto > due.soloNostro.tutto * 1.1);
check("con tre ancora meglio", tre.fuso.tutto > due.fuso.tutto);
check("e con quattro non peggiora", quattro.fuso.tutto >= tre.fuso.tutto * 0.98);
check(
  "nessun campo peggiora rispetto al solo nostro",
  tre.fuso.p >= tre.soloNostro.p && tre.fuso.pr >= tre.soloNostro.pr && tre.fuso.chi >= tre.soloNostro.chi,
  [tre.fuso, tre.soloNostro],
);
console.log(bad === 0 ? "\nFONDERE CONVIENE\n" : `\n${bad} PROBLEMI\n`);
process.exit(bad === 0 ? 0 : 1);

export {};
