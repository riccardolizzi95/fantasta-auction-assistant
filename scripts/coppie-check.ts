/**
 * Due giocatori della stessa squadra e dello stesso ruolo si annullano?
 *
 * Il motore valuta un giocatore alla volta, contro un rimpiazzo teorico. Ma una
 * rosa non e' una somma: due attaccanti che nella stessa squadra si danno il
 * cambio non ti danno due attaccanti, e due portieri della stessa squadra sono
 * quasi sempre un portiere e un posto sprecato.
 *
 * Qui si misura se e' vero, e quanto, sui dati veri: le partite da titolare di
 * due compagni di reparto si sommano fino a coprire la stagione (si alternano)
 * o si sovrappongono (giocano insieme)?
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:coppie
 */
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GIORNATE = 38;

type Riga = {
  player_id: string;
  season: string;
  competition: string | null;
  matches: number;
  minutes: number | null;
  lineups: number | null;
};
type Giocatore = { id: string; name: string; team: string; role: string };

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

async function carica(token: string) {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}` };
  const stats: Riga[] = [];
  for (let da = 0; ; da += 1000) {
    const res = await fetch(
      `${SUPA}/rest/v1/player_stats?select=player_id,season,competition,matches,minutes,lineups`,
      { headers: { ...headers, Range: `${da}-${da + 999}`, "Range-Unit": "items" } },
    );
    const chunk = await res.json();
    if (!Array.isArray(chunk)) throw new Error(JSON.stringify(chunk));
    stats.push(...(chunk as Riga[]));
    if (chunk.length < 1000) break;
  }
  const res = await fetch(`${SUPA}/rest/v1/players?select=id,name,team,role&is_active=eq.true`, {
    headers: { ...headers, Range: "0-999", "Range-Unit": "items" },
  });
  return { stats, players: (await res.json()) as Giocatore[] };
}

async function main() {
  const { stats, players } = await carica(await login());
  const perId = new Map(players.map((p) => [p.id, p]));
  const conTitolarita = stats.filter(
    (r) => (r.competition ?? "serie-a") === "serie-a" && r.lineups != null && r.matches > 0,
  );
  const stagione = [...new Set(conTitolarita.map((r) => r.season))].sort().reverse()[0];
  const righe = conTitolarita.filter((r) => r.season === stagione);
  console.log(`\nStagione ${stagione}: ${righe.length} giocatori del listone con le titolarita'.\n`);

  // Raggruppa per squadra e ruolo, come li compreresti.
  const gruppi = new Map<string, { g: Giocatore; lineups: number; matches: number; minuti: number }[]>();
  for (const r of righe) {
    const g = perId.get(r.player_id);
    if (!g) continue;
    const k = `${g.team}|${g.role}`;
    const lista = gruppi.get(k) ?? [];
    lista.push({ g, lineups: r.lineups!, matches: r.matches, minuti: r.minutes ?? 0 });
    gruppi.set(k, lista);
  }

  console.log("== Quanto si coprono, i primi due di un reparto? ==\n");
  console.log("  ruolo   coppie   titolarita' sommate   quanto della stagione   si annullano?");
  for (const ruolo of ["P", "D", "C", "A"]) {
    const coppie: { somma: number; a: string; b: string; squadra: string }[] = [];
    for (const [k, lista] of gruppi) {
      if (!k.endsWith(`|${ruolo}`)) continue;
      const ordinata = lista.slice().sort((a, b) => b.lineups - a.lineups);
      if (ordinata.length < 2 || ordinata[1].lineups < 3) continue;
      coppie.push({
        somma: ordinata[0].lineups + ordinata[1].lineups,
        a: ordinata[0].g.name,
        b: ordinata[1].g.name,
        squadra: k.split("|")[0],
      });
    }
    if (coppie.length === 0) continue;
    const media = coppie.reduce((a, c) => a + c.somma, 0) / coppie.length;
    // Sotto le 38 significa che insieme non coprono nemmeno una stagione: si
    // stanno davvero alternando su un posto solo. Sopra, occupano due posti.
    const quota = media / GIORNATE;
    console.log(
      `  ${ruolo}      ${coppie.length.toString().padStart(5)}   ${media.toFixed(1).padStart(17)}   ` +
        `${(quota * 100).toFixed(0).padStart(20)}%   ` +
        (quota < 1.15 ? "SI', un posto solo" : "no, due posti diversi"),
    );
  }

  console.log("\n== I casi piu' netti: chi si toglie il posto a vicenda ==\n");
  const netti: { squadra: string; ruolo: string; a: string; b: string; somma: number }[] = [];
  for (const [k, lista] of gruppi) {
    const [squadra, ruolo] = k.split("|");
    const ordinata = lista.slice().sort((a, b) => b.lineups - a.lineups);
    if (ordinata.length < 2 || ordinata[1].lineups < 6) continue;
    const somma = ordinata[0].lineups + ordinata[1].lineups;
    if (somma > GIORNATE * 1.08) continue;
    netti.push({ squadra, ruolo, a: ordinata[0].g.name, b: ordinata[1].g.name, somma });
  }
  netti.sort((a, b) => a.somma - b.somma);
  for (const n of netti.slice(0, 14)) {
    console.log(
      `  ${n.squadra.padEnd(12)} ${n.ruolo}  ${n.a.padEnd(18)} + ${n.b.padEnd(18)} ` +
        `= ${n.somma} titolarita' su ${GIORNATE}`,
    );
  }

  console.log("\n== E i portieri? ==\n");
  // Il caso estremo: se ne schiera uno solo, quindi il secondo vale solo quando
  // il primo non c'e'.
  const portieri = [...gruppi.entries()].filter(([k]) => k.endsWith("|P"));
  let dueVeri = 0;
  for (const [k, lista] of portieri) {
    const ordinata = lista.slice().sort((a, b) => b.lineups - a.lineups);
    if (ordinata.length >= 2 && ordinata[1].lineups >= 8) {
      dueVeri++;
      console.log(
        `  ${k.split("|")[0].padEnd(12)} ${ordinata[0].g.name} ${ordinata[0].lineups} · ` +
          `${ordinata[1].g.name} ${ordinata[1].lineups}`,
      );
    }
  }
  console.log(
    `\n  ${dueVeri} squadre su ${portieri.length} hanno avuto due portieri veri. ` +
      `Nelle altre il secondo non ha giocato: comprarlo e' un posto buttato.\n`,
  );

  await provaIlSecondoPortiere();
}

/**
 * E il motore, lo dice?
 *
 * Il caso che l'utente ha in mente: hai gia' il portiere titolare di una
 * squadra, ti offrono il suo secondo. Quanto ti aggiunge davvero?
 */
async function provaIlSecondoPortiere() {
  const { puntiFormazione } = await import("../src/lib/fanta/formazione");
  const ctx = {
    replacementFM: { P: 5.9, D: 5.9, C: 6.0, A: 6.1 },
    replacementMV: { P: 5.9, D: 5.9, C: 6.0, A: 6.0 },
    modificatore: false,
  };
  const titolare = { role: "P" as const, expFM: 6.6, expMV: 6.3, expApps: 36 };
  const secondo = { role: "P" as const, expFM: 6.4, expMV: 6.2, expApps: 6 };
  const altroBuono = { role: "P" as const, expFM: 6.5, expMV: 6.2, expApps: 34 };
  const daSolo = puntiFormazione([secondo], ctx) - puntiFormazione([], ctx);
  const dopo = puntiFormazione([titolare, secondo], ctx) - puntiFormazione([titolare], ctx);
  const dopoAltro = puntiFormazione([titolare, altroBuono], ctx) - puntiFormazione([titolare], ctx);
  console.log("== Quanto ti aggiunge il secondo portiere? ==\n");
  console.log(`  da solo, in una rosa vuota            ${daSolo.toFixed(2)} punti a giornata`);
  console.log(`  se hai gia' il titolare della squadra  ${dopo.toFixed(2)}`);
  console.log(`  (un secondo portiere che gioca altrove ${dopoAltro.toFixed(2)})`);
  console.log(
    `\n  Il motore lo dice nella scheda: "non entrerebbe in formazione".\n`,
  );

  // ------------------------------------------------------------------ difesa
  //
  // Il modificatore non e' un bonus per giocatore: e' uno solo, sulla media
  // della linea che schieri. Quindi lo stesso difensore vale molto o poco a
  // seconda di dove sta la tua difesa — ed e' una cosa che il prezzo di
  // mercato, uguale per tutti, non puo' dire.
  const { mediaDifesa, bonusModificatore } = await import("../src/lib/fanta/formazione");
  const conMod = { ...ctx, modificatore: true };
  const difensore = (mv: number, apps = 34) => ({
    role: "D" as const, expFM: 6.0, expMV: mv, expApps: apps,
  });
  const portiere = (mv: number) => ({ role: "P" as const, expFM: 6.2, expMV: mv, expApps: 36 });
  const nuovo = difensore(6.5);

  console.log("== Lo stesso difensore, in due difese diverse ==\n");
  for (const [nome, rosa] of [
    ["difesa scarsa (media 5.8)", [portiere(5.8), difensore(5.8), difensore(5.75), difensore(5.8)]],
    ["difesa media (media 6.0)", [portiere(6.0), difensore(6.0), difensore(6.0), difensore(6.0)]],
    ["difesa gia' forte (media 6.4)", [portiere(6.4), difensore(6.4), difensore(6.4), difensore(6.4)]],
  ] as const) {
    const prima = mediaDifesa([...rosa], conMod);
    const dopo = mediaDifesa([...rosa, nuovo], conMod);
    const guadagno = bonusModificatore(dopo) - bonusModificatore(prima);
    console.log(
      `  ${nome.padEnd(30)} ${prima.toFixed(2)} -> ${dopo.toFixed(2)} di media   ` +
        `${guadagno >= 0 ? "+" : ""}${guadagno.toFixed(2)} punti a giornata`,
    );
  }
  console.log(
    "\n  Il modificatore e' lineare nell'intervallo in cui si gioca (quattro punti\n" +
      "  per punto di media): quindi non c'e' nessuna sinergia nascosta fra compagni\n" +
      "  di reparto da sfruttare, e quello che conta e' solo dove sta la tua linea.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
