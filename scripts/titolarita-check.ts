/**
 * Le presenze dell'anno prossimo si prevedono meglio guardando i minuti?
 *
 * Il valore di un giocatore lo decidono soprattutto le presenze attese, e il
 * motore le proietta dalle **presenze** dell'anno scorso. Ma una presenza non e'
 * una titolarita': trenta partite da trenta minuti e trenta da novanta sono due
 * giocatori diversi, e nel fantacalcio chi entra al 70' spesso non prende
 * nemmeno il voto.
 *
 * I minuti e le titolarita' sono in archivio da un pezzo e il motore non li
 * guarda (li usa solo come piccola correzione a coefficienti scelti a mano).
 * Qui si misura, sulle stagioni vere, se guardarli davvero paga — e di quanto.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:titolarita
 */
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Riga = {
  player_id: string;
  season: string;
  competition: string | null;
  matches: number;
  minutes: number | null;
  lineups: number | null;
};

type Assenza = { player_id: string; season: string; saltate: number; per_infortunio: number };

async function login() {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const s = await r.json();
  if (!r.ok) throw new Error(`login: ${JSON.stringify(s)}`);
  return s.access_token as string;
}

async function caricaAssenze(token: string): Promise<Assenza[]> {
  const res = await fetch(
    `${SUPA}/rest/v1/player_absences?select=player_id,season,saltate,per_infortunio`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  const j = await res.json();
  return Array.isArray(j) ? (j as Assenza[]) : [];
}

async function carica(token: string): Promise<Riga[]> {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}` };
  const out: Riga[] = [];
  for (let da = 0; ; da += 1000) {
    const res = await fetch(
      `${SUPA}/rest/v1/player_stats?select=player_id,season,competition,matches,minutes,lineups`,
      { headers: { ...headers, Range: `${da}-${da + 999}`, "Range-Unit": "items" } },
    );
    const chunk = await res.json();
    if (!Array.isArray(chunk)) throw new Error(JSON.stringify(chunk));
    out.push(...(chunk as Riga[]));
    if (chunk.length < 1000) break;
  }
  return out;
}

/** Minimi quadrati su poche colonne: basta l'eliminazione di Gauss. */
function minimiQuadrati(X: number[][], y: number[]): number[] {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  for (let k = 0; k < X.length; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += X[k][i] * X[k][j];
      A[i][n] += X[k][i] * y[k];
    }
  }
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    if (Math.abs(A[i][i]) < 1e-9) continue;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((r, i) => (Math.abs(r[i]) < 1e-9 ? 0 : r[n] / r[i]));
}

const IN_CORSO = "2026-27";

const SUCCESSIVA: Record<string, string> = {
  "2022-23": "2023-24",
  "2023-24": "2024-25",
  "2024-25": "2025-26",
  "2025-26": "2026-27",
};

async function main() {
  const token = await login();
  const righe = await carica(token);
  const assenze = await caricaAssenze(token);
  const serieA = righe.filter((r) => (r.competition ?? "serie-a") === "serie-a");
  const per = new Map<string, Riga>();
  for (const r of serieA) per.set(`${r.player_id}|${r.season}`, r);

  type Coppia = { prevApps: number; minPerPartita: number; titolarita: number; dopo: number };
  const coppie: Coppia[] = [];
  for (const r of serieA) {
    const dopo = per.get(`${r.player_id}|${SUCCESSIVA[r.season] ?? ""}`);
    if (!dopo || !r.minutes || r.matches < 1) continue;
    coppie.push({
      prevApps: r.matches,
      minPerPartita: r.minutes / r.matches,
      titolarita: r.lineups != null ? r.lineups : -1,
      dopo: dopo.matches,
    });
  }
  const conTitolarita = coppie.filter((c) => c.titolarita >= 0);
  console.log(
    `\n${coppie.length} coppie di stagioni consecutive con i minuti, ` +
      `${conTitolarita.length} anche con le titolarita'.\n`,
  );
  if (coppie.length < 60) {
    console.log("Troppo poche per misurare qualcosa. Serve prima riempire l'archivio.\n");
    return;
  }

  // Meta' per imparare, meta' per misurare: un modello con tre coefficienti su
  // duecento punti impara anche il rumore, se lo si misura dove l'ha imparato.
  const mescola = <T,>(a: T[]) => {
    let s = 99;
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };

  type Modello = {
    nome: string;
    colonne: (c: Coppia) => number[];
    /** Alcuni modelli non hanno coefficienti da imparare: li si applica e basta. */
    diretto?: (c: Coppia) => number;
  };

  const modelli: Modello[] = [
    {
      nome: "come fa il motore adesso",
      colonne: () => [1],
      diretto: (c) => {
        // (1 - peso) * presenze + peso * prior, poi la correzione sui minuti
        const base = 0.82 * c.prevApps + 0.18 * 26;
        return base * Math.max(0.78, Math.min(1.08, 0.78 + (c.minPerPartita / 90) * 0.3));
      },
    },
    { nome: "solo le presenze", colonne: (c) => [1, c.prevApps] },
    { nome: "presenze e minuti a partita", colonne: (c) => [1, c.prevApps, c.minPerPartita] },
    {
      nome: "i minuti totali",
      colonne: (c) => [1, (c.prevApps * c.minPerPartita) / 90],
    },
    {
      nome: "presenze, minuti e titolarita'",
      colonne: (c) => [1, c.prevApps, c.minPerPartita, Math.max(0, c.titolarita)],
    },
    {
      nome: "solo le titolarita'",
      colonne: (c) => [1, Math.max(0, c.titolarita)],
    },
  ];

  const valuta = (dati: Coppia[], usaTitolarita: boolean) => {
    const mescolate = mescola(dati);
    const meta = Math.floor(mescolate.length / 2);
    const parti = [
      [mescolate.slice(0, meta), mescolate.slice(meta)],
      [mescolate.slice(meta), mescolate.slice(0, meta)],
    ] as const;
    console.log(
      `  ${usaTitolarita ? "sulle coppie che hanno anche le titolarita'" : "su tutte le coppie con i minuti"} ` +
        `(${dati.length})\n`,
    );
    console.log("    modello                          errore medio   errore mediano");
    for (const m of modelli) {
      if (!usaTitolarita && m.nome.includes("titolarita")) continue;
      const errori: number[] = [];
      for (const [impara, misura] of parti) {
        const prevedi = m.diretto
          ? m.diretto
          : (() => {
              const b = minimiQuadrati(impara.map(m.colonne), impara.map((c) => c.dopo));
              return (c: Coppia) => m.colonne(c).reduce((a, x, i) => a + x * b[i], 0);
            })();
        for (const c of misura) {
          errori.push(Math.abs(Math.max(0, Math.min(38, prevedi(c))) - c.dopo));
        }
      }
      errori.sort((a, b) => a - b);
      const media = errori.reduce((a, b) => a + b, 0) / errori.length;
      console.log(
        `    ${m.nome.padEnd(32)} ${media.toFixed(2).padStart(9)} presenze  ` +
          `${errori[Math.floor(errori.length / 2)].toFixed(2).padStart(9)}`,
      );
    }
    console.log();
  };

  console.log("Quanto sbaglia, chi prevede le presenze dell'anno dopo?\n");
  valuta(coppie, false);
  if (conTitolarita.length >= 60) valuta(conTitolarita, true);

  // ------------------------------------------------------------------ scarti
  //
  // L'errore medio puo' restare uguale e il modello essere comunque da
  // correggere: se sbaglia **sempre nella stessa direzione** su chi gioca poco,
  // sta sistematicamente sopravvalutando i panchinari, e quelli sono proprio
  // quelli che all'asta si pagano troppo. E' lo scarto medio con il segno, non
  // il suo valore assoluto, a dirlo.
  const comeAdesso = (c: Coppia) => {
    const base = (1 - 0.32) * c.prevApps + 0.32 * 24;
    return Math.max(
      0,
      Math.min(38, base * Math.max(0.78, Math.min(1.08, 0.78 + (c.minPerPartita / 90) * 0.3))),
    );
  };
  const APPS_PRIOR = 24;
  console.log("Sbaglia sempre nella stessa direzione? (+ = promette piu' presenze di quante ne fara')\n");
  console.log("    minuti a partita      quanti   scarto medio   presenze vere");
  const fasce: [string, (c: Coppia) => boolean][] = [
    ["meno di 30'", (c) => c.minPerPartita < 30],
    ["fra 30' e 55'", (c) => c.minPerPartita >= 30 && c.minPerPartita < 55],
    ["fra 55' e 75'", (c) => c.minPerPartita >= 55 && c.minPerPartita < 75],
    ["piu' di 75'", (c) => c.minPerPartita >= 75],
  ];
  for (const [nome, dentro] of fasce) {
    const g = coppie.filter(dentro);
    if (g.length === 0) continue;
    const scarto = g.reduce((a, c) => a + (comeAdesso(c) - c.dopo), 0) / g.length;
    const vere = g.reduce((a, c) => a + c.dopo, 0) / g.length;
    console.log(
      `    ${nome.padEnd(20)} ${g.length.toString().padStart(6)}   ${(scarto >= 0 ? "+" : "") + scarto.toFixed(1)} presenze`.padEnd(64) +
        `${vere.toFixed(1)}`,
    );
  }
  console.log();

  // ---------------------------------------------------------------- taratura
  //
  // Se il correttivo sui minuti spinge dalla parte sbagliata, la domanda giusta
  // non e' "come lo aggiusto" ma "quanto va tirata verso la media la stima".
  // Qui si prova senza correttivo, al variare di quanto si tira.
  console.log("Senza il correttivo sui minuti, tirando piu' o meno verso la media:\n");
  console.log("    quanto tira   errore medio   scarto <30'   30-55'   55-75'   >75'");
  for (const w of [0.32, 0.4, 0.5, 0.6, 0.7]) {
    const stima = (c: Coppia) => Math.max(0, Math.min(38, (1 - w) * c.prevApps + w * APPS_PRIOR));
    const err = coppie.reduce((a, c) => a + Math.abs(stima(c) - c.dopo), 0) / coppie.length;
    const scarti = fasce.map(([, dentro]) => {
      const g = coppie.filter(dentro);
      return g.length ? g.reduce((a, c) => a + (stima(c) - c.dopo), 0) / g.length : 0;
    });
    console.log(
      `    ${w.toFixed(2).padStart(11)}   ${err.toFixed(2).padStart(9)}      ` +
        scarti.map((x) => `${(x >= 0 ? "+" : "") + x.toFixed(1)}`.padStart(8)).join(" "),
    );
  }
  console.log();

  // ------------------------------------------------------------------ fragilita'
  //
  // Lo stato fisico di oggi non ce l'abbiamo, ma una cosa la sappiamo gia': chi
  // si e' rotto in passato tende a rompersi ancora. La domanda misurabile e' se
  // le stagioni interrotte del passato dicono qualcosa **in piu'** delle
  // presenze dell'ultima, che il motore gia' guarda.
  //
  // "Interrotta" vuol dire poche presenze in una stagione in cui quel giocatore
  // era in Serie A: non aver giocato perche' eri altrove non e' un infortunio.
  const perGiocatore = new Map<string, { season: string; matches: number }[]>();
  for (const r of serieA) {
    const lista = perGiocatore.get(r.player_id) ?? [];
    lista.push({ season: r.season, matches: r.matches });
    perGiocatore.set(r.player_id, lista);
  }
  type Storia = { prevApps: number; interrotte: number; stagioni: number; dopo: number };
  const storie: Storia[] = [];
  for (const [id, lista] of perGiocatore) {
    const ordinata = lista.slice().sort((a, b) => (a.season < b.season ? 1 : -1));
    for (const r of ordinata) {
      const dopo = ordinata.find((x) => x.season === SUCCESSIVA[r.season]);
      // La stagione in corso ha giocato due giornate: come bersaglio non vale.
      if (!dopo || dopo.season === IN_CORSO || r.matches < 1) continue;
      const passate = ordinata.filter((x) => x.season < r.season);
      if (passate.length < 2) continue;
      storie.push({
        prevApps: r.matches,
        interrotte: passate.filter((x) => x.matches > 0 && x.matches <= 20).length,
        stagioni: passate.length,
        dopo: dopo.matches,
      });
    }
    void id;
  }
  if (storie.length >= 60) {
    console.log(
      `Chi si e' gia' fermato, si ferma ancora? (${storie.length} casi con almeno due stagioni prima)\n`,
    );
    console.log("    stagioni interrotte prima   quanti   presenze l'anno dopo   scarto dal modello");
    const stimaBase = (h: Storia) => (1 - 0.32) * h.prevApps + 0.32 * APPS_PRIOR;
    for (const [nome, dentro] of [
      ["nessuna", (h: Storia) => h.interrotte === 0],
      ["una", (h: Storia) => h.interrotte === 1],
      ["due o piu'", (h: Storia) => h.interrotte >= 2],
    ] as const) {
      const g = storie.filter(dentro);
      if (g.length < 10) continue;
      const vere = g.reduce((a, h) => a + h.dopo, 0) / g.length;
      const scarto = g.reduce((a, h) => a + (stimaBase(h) - h.dopo), 0) / g.length;
      console.log(
        `    ${nome.padEnd(26)} ${g.length.toString().padStart(6)}   ${vere.toFixed(1).padStart(19)}   ` +
          `${(scarto >= 0 ? "+" : "") + scarto.toFixed(1)}`,
      );
    }
    console.log();
  }

  // ------------------------------------------------------------ infortuni
  //
  // Le presenze dicono quante partite ha giocato, non **perche'** ha saltato le
  // altre. Adesso lo sappiamo: l'archivio tiene il motivo di ogni assenza. La
  // domanda e' se saperlo aggiunge qualcosa a quello che il modello gia' vede.
  if (assenze.length > 0) {
    const perChiave = new Map(assenze.map((a) => [`${a.player_id}|${a.season}`, a]));
    type Caso = { prevApps: number; infortuni: number; dopo: number };
    const casi: Caso[] = [];
    for (const r of serieA) {
      const dopo = per.get(`${r.player_id}|${SUCCESSIVA[r.season] ?? ""}`);
      const a = perChiave.get(`${r.player_id}|${r.season}`);
      if (!dopo || dopo.season === IN_CORSO || !a || r.matches < 1) continue;
      casi.push({ prevApps: r.matches, infortuni: a.per_infortunio, dopo: dopo.matches });
    }
    if (casi.length >= 40) {
      console.log(
        `Le partite saltate per infortunio dicono qualcosa in piu'? (${casi.length} casi)\n`,
      );
      console.log("    saltate per infortunio   quanti   presenze l'anno dopo   scarto dal modello");
      const stima = (c: Caso) => (1 - 0.32) * c.prevApps + 0.32 * APPS_PRIOR;
      for (const [nome, dentro] of [
        ["nessuna", (c: Caso) => c.infortuni === 0],
        ["da 1 a 3", (c: Caso) => c.infortuni >= 1 && c.infortuni <= 3],
        ["da 4 a 8", (c: Caso) => c.infortuni >= 4 && c.infortuni <= 8],
        ["piu' di 8", (c: Caso) => c.infortuni > 8],
      ] as const) {
        const g = casi.filter(dentro);
        if (g.length < 8) continue;
        const vere = g.reduce((a, c) => a + c.dopo, 0) / g.length;
        const scarto = g.reduce((a, c) => a + (stima(c) - c.dopo), 0) / g.length;
        console.log(
          `    ${nome.padEnd(23)} ${g.length.toString().padStart(6)}   ${vere.toFixed(1).padStart(19)}   ` +
            `${(scarto >= 0 ? "+" : "") + scarto.toFixed(1)}`,
        );
      }
      console.log();
    }
  }

  // I coefficienti da portarsi nel motore, imparati su tutto.
  const b = minimiQuadrati(
    coppie.map((c) => [1, c.prevApps, c.minPerPartita]),
    coppie.map((c) => c.dopo),
  );
  console.log(
    `Presenze attese = ${b[0].toFixed(2)} + ${b[1].toFixed(3)} x presenze + ${b[2].toFixed(3)} x minuti-a-partita\n`,
  );
  const bt = conTitolarita.length >= 60
    ? minimiQuadrati(
        conTitolarita.map((c) => [1, c.prevApps, c.minPerPartita, c.titolarita]),
        conTitolarita.map((c) => c.dopo),
      )
    : null;
  if (bt) {
    console.log(
      `Con le titolarita' = ${bt[0].toFixed(2)} + ${bt[1].toFixed(3)} x presenze + ` +
        `${bt[2].toFixed(3)} x minuti-a-partita + ${bt[3].toFixed(3)} x titolarita'\n`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
