/**
 * La catena del riconoscimento del parlante, misurata.
 *
 * Qui non si misura quanto il software ci prende all'asta — quello dipende dalle
 * voci vere, dal microfono vero e dal rumore vero, e lo misura l'app da sola con
 * la prova a schermo. Qui si misura **la macchina**: date otto voci diverse per
 * costruzione, la catena le separa? E continua a separarle quando la stanza fa
 * rumore, quando parlano un po' piu' forte, quando dicono una frase diversa?
 *
 * Le voci sono sintetizzate col modello sorgente-filtro: un treno di impulsi
 * alla frequenza delle corde vocali, filtrato dalle risonanze del tratto vocale.
 * Due persone diverse hanno corde diverse e tratto diverso, ed e' esattamente
 * quello che i coefficienti cepstrali dovrebbero vedere.
 */
import {
  FREQUENZA,
  chiHaParlato,
  coefficienti,
  fondiImpronte,
  impronta,
  somiglianzaVoci,
  taraSullaLega,
  type Metro,
  type Profilo,
} from "../src/lib/fanta/voce";

type Voce = { nome: string; f0: number; formanti: number[]; larghezze: number[] };

/** Otto tratti vocali diversi: due donne, sei uomini, come a un'asta. */
const VOCI: Voce[] = [
  { nome: "Giorgio", f0: 112, formanti: [640, 1190, 2390, 3400], larghezze: [70, 100, 140, 200] },
  { nome: "Marco", f0: 98, formanti: [570, 1050, 2450, 3300], larghezze: [60, 90, 150, 210] },
  { nome: "Luca", f0: 128, formanti: [720, 1300, 2500, 3500], larghezze: [80, 110, 130, 190] },
  { nome: "Andrea", f0: 105, formanti: [600, 1420, 2300, 3250], larghezze: [65, 95, 145, 205] },
  { nome: "Giulia", f0: 205, formanti: [850, 1650, 2900, 3900], larghezze: [90, 120, 160, 220] },
  { nome: "Sara", f0: 190, formanti: [790, 1520, 2750, 3750], larghezze: [85, 115, 155, 215] },
  { nome: "Paolo", f0: 88, formanti: [520, 980, 2200, 3100], larghezze: [55, 85, 135, 195] },
  { nome: "Davide", f0: 140, formanti: [680, 1240, 2600, 3600], larghezze: [75, 105, 125, 185] },
];

let seme = 12345;
const caso = () => {
  seme = (seme * 1103515245 + 12345) & 0x7fffffff;
  return seme / 0x7fffffff;
};

/**
 * Un pezzo di parlato.
 *
 * `vocali` cambia le risonanze nel tempo: una frase non e' un suono fermo, e una
 * firma che regge solo su una vocale non servirebbe a niente.
 */
/**
 * Le sette vocali italiane, come scarto sulle risonanze del tratto vocale.
 *
 * Sono la cosa che un testo da leggere deve coprire tutta: l'impronta e' fatta
 * di media e dispersione su cio' che si e' pronunciato, quindi chi
 * all'iscrizione dice solo due vocali ha mappato due vocali — e all'asta ne usa
 * sette.
 */
const VOCALI = [1, 1.18, 0.82, 1.09, 0.9, 1.24, 0.76];

/** Il testo uguale per tutti: le tocca tutte, e qualcuna due volte. */
const COPIONE_COMUNE = [0, 1, 2, 3, 4, 5, 6, 2, 0, 4, 3, 1];

/** Quello che uno dice se gli si chiede solo "parla": pochi suoni, e i suoi. */
const copioneACaso = (quanti = 3) =>
  Array.from({ length: quanti }, () => Math.floor(caso() * VOCALI.length));

function parla(
  v: Voce,
  durata: number,
  opzioni: { rumore?: number; guadagno?: number; copione?: number[] } = {},
) {
  const { rumore = 0, guadagno = 1, copione = copioneACaso(4) } = opzioni;
  const n = Math.round(durata * FREQUENZA);
  const grezzo = new Float32Array(n);

  // sorgente: impulsi glottali con un filo di irregolarita', come una voce vera
  let prossimo = 0;
  for (let i = 0; i < n; i++) {
    if (i >= prossimo) {
      grezzo[i] = 1;
      prossimo = i + (FREQUENZA / v.f0) * (0.94 + 0.12 * caso());
    }
  }

  const out = new Float32Array(n);
  // ogni formante e' un risonatore a due poli; le vocali li spostano nel tempo
  for (let f = 0; f < v.formanti.length; f++) {
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const fase = copione[Math.min(copione.length - 1, Math.floor((i / n) * copione.length))];
      // scarto per vocale: [a] apre il primo formante, [i] alza il secondo...
      const scarto = VOCALI[fase % VOCALI.length] ** (f === 0 ? 1 : f === 1 ? -0.7 : 0.2);
      const fc = v.formanti[f] * scarto;
      const r = Math.exp((-Math.PI * v.larghezze[f]) / FREQUENZA);
      const c = 2 * r * Math.cos((2 * Math.PI * fc) / FREQUENZA);
      const y = grezzo[i] + c * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      out[i] += y / (f + 1.5);
    }
  }

  let picco = 0;
  for (let i = 0; i < n; i++) picco = Math.max(picco, Math.abs(out[i]));
  for (let i = 0; i < n; i++) {
    out[i] = (out[i] / (picco || 1)) * guadagno + rumore * (caso() * 2 - 1);
  }
  return out;
}

const firma = (c: Float32Array) => impronta(coefficienti(c));

function iscrivi(v: Voce, copione?: number[]): Profilo {
  // l'iscrizione: qualche secondo, spezzato, come lo chiede l'app. Con un
  // copione, tutti leggono lo stesso testo; senza, ognuno dice quello che gli
  // viene, che e' come funzionava prima.
  const pezzi = copione
    ? [0, 1, 2].map((k) =>
        parla(v, 1.6, { copione: copione.slice(k * 4, k * 4 + 4).length ? copione.slice(k * 4, k * 4 + 4) : copione }),
      )
    : [parla(v, 1.6, {}), parla(v, 1.6, {}), parla(v, 1.6, {})];
  const firme = pezzi.map(firma).filter((x): x is Float32Array => x !== null);
  const imp = fondiImpronte(firme);
  if (!imp) throw new Error("iscrizione fallita");
  // Le due meta' della lettura, come le tiene l'app: servono a sapere quanto
  // quella voce somiglia a se stessa.
  const a = fondiImpronte(firme.slice(0, Math.ceil(firme.length / 2)));
  const b = fondiImpronte(firme.slice(Math.ceil(firme.length / 2)));
  return {
    participantId: v.nome,
    nome: v.nome,
    impronta: Array.from(imp),
    meta: a && b ? [Array.from(a), Array.from(b)] : undefined,
  };
}

/**
 * Due semi fissi, e uno di essi rimesso a posto dopo l'iscrizione.
 *
 * Senza, ogni confronto era falsato: l'iscrizione consuma numeri a caso, quindi
 * due modi diversi di iscriversi lasciavano il generatore in stati diversi e le
 * frasi di prova non erano piu' le stesse. Si finiva per misurare la fortuna
 * delle frasi invece del modo di iscriversi — e infatti il confronto cambiava
 * verso da una esecuzione all'altra.
 */
const SEME_ISCRIZIONE = 12345;
const SEME_PROVE = 777_777;

function prova(nome: string, opzioni: Parameters<typeof parla>[2], volte = 40, copione?: number[]) {
  seme = SEME_ISCRIZIONE;
  const profili = VOCI.map((v) => iscrivi(v, copione));
  const metro = taraSullaLega(profili);
  seme = SEME_PROVE;
  let giusti = 0;
  let sbagliati = 0;
  let incerti = 0;
  for (const v of VOCI) {
    for (let k = 0; k < volte; k++) {
      const imp = firma(parla(v, 1.2 + caso() * 0.8, opzioni));
      if (!imp) continue;
      const chi = chiHaParlato(imp, profili, metro);
      if (!chi) incerti++;
      else if (chi.participantId === v.nome) giusti++;
      else sbagliati++;
    }
  }
  const tot = giusti + sbagliati + incerti;
  const pct = (x: number) => `${((100 * x) / tot).toFixed(0)}%`.padStart(4);
  console.log(
    `  ${nome.padEnd(30)} giusto ${pct(giusti)}   sbagliato ${pct(sbagliati)}   "non lo so" ${pct(incerti)}`,
  );
  return { giusti, sbagliati, incerti, tot };
}

// Tutte le prove che seguono iscrivono leggendo il testo comune, perche' e'
// quello che l'app chiede di fare, e provano su frasi che quella persona non
// aveva mai detto — che e' quello che succede all'asta.
console.log("\nSepara otto voci diverse? (all'asta dicono cose che all'iscrizione non avevano detto)\n");
const pulito = prova("stanza silenziosa", {}, 40, COPIONE_COMUNE);
prova("un po' di rumore", { rumore: 0.02 }, 40, COPIONE_COMUNE);
prova("stanza rumorosa", { rumore: 0.06 }, 40, COPIONE_COMUNE);
prova("stanza molto rumorosa", { rumore: 0.12 }, 40, COPIONE_COMUNE);
prova("parla piu' piano", { guadagno: 0.35 }, 40, COPIONE_COMUNE);
prova("parla molto piu' forte", { guadagno: 1.0, rumore: 0.01 }, 40, COPIONE_COMUNE);

const salvate = VOCI.slice();

/**
 * Serve davvero far leggere un testo?
 *
 * Due modi di iscriversi, stesse voci, stesse prove. "dicendo qualcosa" e' come
 * funzionava prima: ognuno parla e dice quello che gli viene, quindi ognuno
 * copre suoni diversi. "leggendo lo stesso testo" e' un copione che le tocca
 * tutte, uguale per tutti.
 *
 * Le prove restano libere in entrambi i casi, perche' all'asta nessuno legge un
 * testo: si urla un numero. Quindi qui non si sta misurando il vantaggio di
 * confrontare due letture uguali — quello sarebbe barare — ma solo se
 * un'iscrizione fatta bene regge meglio a quello che viene dopo.
 */
console.log("\nL'iscrizione: dire qualcosa, o leggere un testo?\n");
for (const [nome, copione] of [
  ["dicendo qualcosa", undefined],
  ["leggendo lo stesso testo", COPIONE_COMUNE],
] as const) {
  prova(`  ${nome}`.padEnd(28), { rumore: 0.03 }, 40, copione);
}
{
  seme = SEME_ISCRIZIONE;
  const a = VOCI.map((v) => iscrivi(v));
  seme = SEME_ISCRIZIONE;
  const b = VOCI.map((v) => iscrivi(v, COPIONE_COMUNE));
  const stacco = (profili: Profilo[]) => {
    const m = taraSullaLega(profili);
    seme = SEME_PROVE;
    let propria = 0;
    let altrui = 0;
    let coppie = 0;
    for (const v of VOCI) {
      const imp = firma(parla(v, 1.4, { rumore: 0.03 }));
      if (!imp) continue;
      for (const { x, s } of punteggiCentrati(imp, profili, m)) {
        if (x.nome === v.nome) propria += s;
        else {
          altrui += s;
          coppie++;
        }
      }
    }
    return propria / VOCI.length - altrui / coppie;
  };
  console.log(
    `\n  stacco fra la propria impronta e le altre: ` +
      `${stacco(a).toFixed(3)} dicendo qualcosa, ${stacco(b).toFixed(3)} leggendo lo stesso testo`,
  );
}

/**
 * Il caso difficile, e quello che conta.
 *
 * Otto voci costruite apposta per essere diverse le separa chiunque. All'asta
 * pero' ci sono spesso otto uomini della stessa eta' e della stessa citta', cioe'
 * tratti vocali che si somigliano. Qui le voci vengono avvicinate finche' non si
 * rompe: e' quel punto che dice a quanto puo' arrivare questa catena.
 */
function ravvicina(quanto: number): Voce[] {
  const base = salvate[0];
  return salvate.map((v, i) => ({
    nome: v.nome,
    f0: base.f0 + (v.f0 - base.f0) * quanto + i * 0.5,
    formanti: base.formanti.map((f, k) => f + (v.formanti[k] - f) * quanto),
    larghezze: base.larghezze.map((l, k) => l + (v.larghezze[k] - l) * quanto),
  }));
}

console.log("\nE se le voci si somigliano? (100% = le otto di sopra, 10% = quasi identiche)\n");
for (const quanto of [0.5, 0.25, 0.12, 0.06]) {
  const ravvicinate = ravvicina(quanto);
  VOCI.length = 0;
  VOCI.push(...ravvicinate);
  prova(`somiglianza al ${Math.round((1 - quanto) * 100)}%`, { rumore: 0.02 }, 40, COPIONE_COMUNE);
}
VOCI.length = 0;
VOCI.push(...salvate);

/**
 * Dove va messa l'asticella, misurato invece che deciso.
 *
 * Con voci molto diverse basta poco per essere sicuri; con voci simili lo stacco
 * fra il primo e il secondo e' piccolo per tutti, e un'asticella alta fa dire
 * "non lo so" sempre. Quindi l'asticella non puo' essere una costante: va
 * ricavata da **quanto si somigliano le voci iscritte**, che e' una cosa che si
 * misura una volta sola, alla fine dell'iscrizione.
 */
console.log("\nQuanto stacca il primo dal secondo, al variare della somiglianza fra le voci:\n");
console.log(
  "  voci simili al   coppia piu' vicina   stacco tipico   la migliore   quella scelta",
);

function punteggiCentrati(imp: Float32Array, profili: Profilo[], metro: Metro) {
  const c = (v: Float32Array) => {
    const o = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) o[i] = v[i] - (metro.centro[i] ?? 0);
    let n = 0;
    for (let i = 0; i < o.length; i++) n += o[i] * o[i];
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < o.length; i++) o[i] /= n;
    return o;
  };
  const v = c(imp);
  return profili
    .map((x) => ({ x, s: somiglianzaVoci(v, c(Float32Array.from(x.impronta))) }))
    .sort((a, b) => b.s - a.s);
}
for (const quanto of [1, 0.5, 0.25, 0.12, 0.06]) {
  const gruppo = quanto === 1 ? salvate : ravvicina(quanto);
  const profili = gruppo.map((v) => iscrivi(v, COPIONE_COMUNE));
  const metro = taraSullaLega(profili);
  const vicina = 1 - metro.margine / 0.35;

  const stacchi: { margine: number; giusto: boolean }[] = [];
  for (const v of gruppo) {
    for (let k = 0; k < 10; k++) {
      const imp = firma(parla(v, 1.4, { rumore: 0.02 }));
      if (!imp) continue;
      const p = punteggiCentrati(imp, profili, metro);
      stacchi.push({ margine: p[0].s - p[1].s, giusto: p[0].x.nome === v.nome });
    }
  }
  const mediano = stacchi.map((x) => x.margine).sort((a, b) => a - b)[Math.floor(stacchi.length / 2)];

  // quale asticella massimizza (giusti - sbagliati), che e' quello che vogliamo:
  // un errore costa piu' di un "non lo so"
  let migliore = { soglia: 0, resa: -1e9 };
  for (let t = 0; t <= 0.3; t += 0.002) {
    const resa = stacchi.reduce(
      (acc, x) => acc + (x.margine < t ? 0 : x.giusto ? 1 : -2),
      0,
    );
    if (resa > migliore.resa) migliore = { soglia: t, resa };
  }
  console.log(
    `  ${`${Math.round((1 - quanto) * 100)}%`.padStart(14)}   ${vicina.toFixed(3).padStart(18)}   ` +
      `${mediano.toFixed(3).padStart(13)}   ${migliore.soglia.toFixed(3).padStart(15)}` +
      `   ${metro.margine.toFixed(3).padStart(10)}`,
  );
}

/**
 * Quanto pretendere: la quota della propria stabilita'.
 *
 * Il testo letto rende disponibile un numero che prima non c'era — quanto una
 * voce somiglia a se stessa fra la prima e la seconda meta' della lettura — e
 * quel numero e' il tetto di cio' che si puo' pretendere da un riconoscimento.
 * Qui si cerca la frazione di quel tetto sotto la quale conviene rispondere
 * "non lo so", contando un errore come due riconoscimenti giusti buttati.
 */
console.log("\nQuanto pretendere, in frazione di quanto una voce somiglia a se stessa:\n");
console.log("  quota   giusti  sbagliati  non lo so   resa");
for (const quota of [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
  let g = 0;
  let x = 0;
  let n = 0;
  for (const [gruppo, rumore] of [
    [salvate, 0.02],
    [ravvicina(0.5), 0.02],
    [ravvicina(0.25), 0.02],
    [salvate, 0.12],
  ] as const) {
    seme = SEME_ISCRIZIONE;
    const profili = gruppo.map((v) => iscrivi(v, COPIONE_COMUNE));
    const m = taraSullaLega(profili);
    seme = SEME_PROVE;
    for (const v of gruppo) {
      for (let k = 0; k < 15; k++) {
        const imp = firma(parla(v, 1.4, { rumore }));
        if (!imp) continue;
        const p = punteggiCentrati(imp, profili, m);
        const margine = p[0].s - p[1].s;
        const richiesto = Math.max(0.02, 0.35 * (1 - (m.vicinanza[
          [p[0].x.participantId, p[1].x.participantId].sort().join("|")
        ] ?? 0)));
        const passa = p[0].s >= m.minima && margine >= richiesto && p[0].s >= m.stabilita * quota;
        if (!passa) n++;
        else if (p[0].x.nome === v.nome) g++;
        else x++;
      }
    }
  }
  const tot = g + x + n;
  console.log(
    `  ${quota.toFixed(1).padStart(5)}   ${((100 * g) / tot).toFixed(0).padStart(5)}%  ` +
      `${((100 * x) / tot).toFixed(0).padStart(8)}%  ${((100 * n) / tot).toFixed(0).padStart(8)}%  ${(g - 2 * x).toString().padStart(5)}`,
  );
}

console.log("\nQuanto stacca la voce giusta dalle altre (stanza silenziosa):\n");
const profili = VOCI.map((v) => iscrivi(v, COPIONE_COMUNE));
const metroFinale = taraSullaLega(profili);
let sommaGiusta = 0;
let sommaAltre = 0;
let coppie = 0;
for (const v of VOCI) {
  const imp = firma(parla(v, 1.5, {}));
  if (!imp) continue;
  for (const { x: p, s } of punteggiCentrati(imp, profili, metroFinale)) {
    if (p.nome === v.nome) sommaGiusta += s;
    else {
      sommaAltre += s;
      coppie++;
    }
  }
}
console.log(`  alla propria impronta   ${(sommaGiusta / VOCI.length).toFixed(3)}`);
console.log(`  a quella degli altri    ${(sommaAltre / coppie).toFixed(3)}`);
console.log(
  `  stacco                  ${(sommaGiusta / VOCI.length - sommaAltre / coppie).toFixed(3)}\n`,
);

if (pulito.giusti / pulito.tot < 0.6) {
  console.log("La catena non separa nemmeno voci sintetiche pulite: non ha senso portarla all'asta.\n");
  process.exit(1);
}
