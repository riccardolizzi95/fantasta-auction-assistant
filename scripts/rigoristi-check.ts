/**
 * Chi tira i rigori, e quanto vale saperlo.
 *
 * Un rigorista di una squadra di Serie A batte quattro o cinque rigori a
 * stagione: dodici o quindici punti fantacalcio, cioe' la differenza fra un
 * attaccante buono e uno molto buono. All'asta e' una delle prime cose che si
 * guarda, e il software non la dice.
 *
 * Ma c'e' una trappola, ed e' il motivo per cui qui si misura invece di
 * aggiungere un bonus: **i rigori dell'anno scorso sono gia' dentro la sua
 * fantamedia dell'anno scorso**. Aggiungerli di nuovo li conterebbe due volte.
 * La domanda vera e' un'altra: un gol su rigore vale, per prevedere l'anno
 * prossimo, quanto un gol su azione? Se vale **meno** — perche' il ruolo di
 * rigorista si perde piu' facilmente di quanto si perda il fiuto del gol —
 * allora una fantamedia gonfiata dai rigori va scontata, non premiata.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:rigoristi
 */
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Riga = {
  player_id: string;
  season: string;
  competition: string | null;
  matches: number;
  goals: number | null;
  pen_scored: number | null;
  pen_missed: number | null;
};

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
      `${SUPA}/rest/v1/player_stats?select=player_id,season,competition,matches,goals,pen_scored,pen_missed`,
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
  const players = (await res.json()) as { id: string; name: string; team: string; role: string }[];
  return { stats, players };
}

const SUCCESSIVA: Record<string, string> = {
  "2022-23": "2023-24",
  "2023-24": "2024-25",
  "2024-25": "2025-26",
  "2025-26": "2026-27",
};

async function main() {
  const { stats, players } = await carica(await login());
  const serieA = stats.filter((r) => (r.competition ?? "serie-a") === "serie-a");
  const per = new Map<string, Riga>();
  for (const r of serieA) per.set(`${r.player_id}|${r.season}`, r);
  const perId = new Map(players.map((p) => [p.id, p]));

  const tirati = (r: Riga) => (r.pen_scored ?? 0) + (r.pen_missed ?? 0);

  // ------------------------------------------------------------------ 1
  console.log("\n== Chi tira i rigori resta il rigorista? ==\n");
  const coppie = serieA
    .map((r) => ({ prima: r, dopo: per.get(`${r.player_id}|${SUCCESSIVA[r.season] ?? ""}`) }))
    .filter((x): x is { prima: Riga; dopo: Riga } => !!x.dopo && x.prima.matches >= 10);
  const rigoristi = coppie.filter((x) => tirati(x.prima) >= 3);
  const altri = coppie.filter((x) => tirati(x.prima) === 0 && (x.prima.goals ?? 0) >= 3);
  const media = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  console.log(
    `  chi ne ha tirati almeno 3 (${rigoristi.length} casi): l'anno dopo ne tira ` +
      `${media(rigoristi.map((x) => tirati(x.dopo))).toFixed(1)} in media`,
  );
  console.log(
    `  chi non ne ha tirati nessuno ma segnava (${altri.length} casi): l'anno dopo ne tira ` +
      `${media(altri.map((x) => tirati(x.dopo))).toFixed(1)}`,
  );
  const restano = rigoristi.filter((x) => tirati(x.dopo) >= 2).length;
  console.log(
    `  resta rigorista il ${((100 * restano) / Math.max(1, rigoristi.length)).toFixed(0)}% di chi lo era.`,
  );

  // ------------------------------------------------------------------ 2
  console.log("\n== Un gol su rigore vale quanto uno su azione, per l'anno dopo? ==\n");
  // Si guarda quanto di ciascun tipo si ripete: il rapporto fra i gol dell'anno
  // dopo e quelli dell'anno prima, tenuti separati.
  const conGol = coppie.filter((x) => (x.prima.goals ?? 0) >= 2 && x.prima.matches >= 15);
  const suRigore = conGol.reduce((a, x) => a + (x.prima.pen_scored ?? 0), 0);
  const suAzione = conGol.reduce((a, x) => a + ((x.prima.goals ?? 0) - (x.prima.pen_scored ?? 0)), 0);
  const dopoRigore = conGol.reduce((a, x) => a + (x.dopo.pen_scored ?? 0), 0);
  const dopoAzione = conGol.reduce((a, x) => a + ((x.dopo.goals ?? 0) - (x.dopo.pen_scored ?? 0)), 0);
  console.log(`  su ${conGol.length} giocatori che segnavano:`);
  console.log(
    `    gol su rigore   ${suRigore.toString().padStart(4)} -> ${dopoRigore.toString().padStart(4)}   ` +
      `si ripete il ${((100 * dopoRigore) / Math.max(1, suRigore)).toFixed(0)}%`,
  );
  console.log(
    `    gol su azione   ${suAzione.toString().padStart(4)} -> ${dopoAzione.toString().padStart(4)}   ` +
      `si ripete il ${((100 * dopoAzione) / Math.max(1, suAzione)).toFixed(0)}%`,
  );

  // ------------------------------------------------------------------ 3
  console.log("\n== I rigoristi del listone di oggi ==\n");
  // L'ultima stagione conclusa con i rigori in archivio, squadra per squadra.
  const stagioni = [...new Set(serieA.map((r) => r.season))].sort().reverse();
  const ultima = stagioni.find((s) => serieA.some((r) => r.season === s && tirati(r) > 0));
  if (!ultima) {
    console.log("  Nessun rigore in archivio.\n");
    return;
  }
  const perSquadra = new Map<string, { nome: string; tirati: number; segnati: number }[]>();
  for (const r of serieA) {
    if (r.season !== ultima || tirati(r) === 0) continue;
    const p = perId.get(r.player_id);
    if (!p) continue;
    const lista = perSquadra.get(p.team) ?? [];
    lista.push({ nome: p.name, tirati: tirati(r), segnati: r.pen_scored ?? 0 });
    perSquadra.set(p.team, lista);
  }
  console.log(`  Stagione ${ultima}. ${perSquadra.size} squadre hanno un rigorista nel listone di oggi.\\n`);
  for (const [squadra, lista] of [...perSquadra.entries()].sort()) {
    const ordinata = lista.sort((a, b) => b.tirati - a.tirati);
    const tot = ordinata.reduce((a, x) => a + x.tirati, 0);
    const primo = ordinata[0];
    console.log(
      `    ${squadra.padEnd(12)} ${primo.nome.padEnd(18)} ${primo.tirati}/${tot} rigori della squadra` +
        (ordinata.length > 1 ? `   (anche ${ordinata.slice(1).map((x) => `${x.nome} ${x.tirati}`).join(", ")})` : ""),
    );
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
