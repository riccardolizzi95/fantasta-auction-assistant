/**
 * La ricerca del giocatore, misurata sul listone vero.
 *
 * All'asta hai pochi secondi e stai digitando con una mano mentre il banditore
 * parla. La domanda non e' se la ricerca funziona, e' **in quanti tasti arrivi
 * al giocatore giusto** — e se ci arrivi partendo da quello che hai in testa in
 * quel momento, che a volte e' il cognome del listone, a volte il nome di
 * battesimo che sul listone non c'e', a volte la squadra.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:ricerca
 */
import { indicizza, paroleDi, punteggio, type Indice } from "../src/lib/fanta/ricerca";

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type Voce = { id: string; name: string; team: string; fullName: string | null };

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

async function carica(token: string): Promise<Voce[]> {
  const headers = { apikey: ANON, Authorization: `Bearer ${token}` };
  const out: Voce[] = [];
  for (let da = 0; ; da += 1000) {
    const res = await fetch(
      `${SUPA}/rest/v1/players?select=id,name,team,player_identities(full_name)&is_active=eq.true`,
      { headers: { ...headers, Range: `${da}-${da + 999}`, "Range-Unit": "items" } },
    );
    const chunk = (await res.json()) as {
      id: string;
      name: string;
      team: string;
      player_identities: { full_name: string | null }[] | { full_name: string | null } | null;
    }[];
    if (!Array.isArray(chunk)) throw new Error(JSON.stringify(chunk));
    for (const r of chunk) {
      const ident = Array.isArray(r.player_identities) ? r.player_identities[0] : r.player_identities;
      out.push({ id: r.id, name: r.name, team: r.team, fullName: ident?.full_name ?? null });
    }
    if (chunk.length < 1000) break;
  }
  return out;
}

/** Il modo vecchio: solo il nome del listone e la squadra, senza incroci. */
function vecchia(q: string, elenco: Voce[]): Voce[] {
  const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const s = strip(q.trim());
  const out: { v: Voce; p: number }[] = [];
  for (const v of elenco) {
    const name = strip(v.name);
    const team = strip(v.team);
    let p = 0;
    if (name.startsWith(s)) p = 100;
    else if (name.includes(s)) p = 70;
    else if (team.startsWith(s)) p = 40;
    else if (team.includes(s)) p = 25;
    if (p > 0) out.push({ v, p });
  }
  return out.sort((a, b) => b.p - a.p).map((x) => x.v);
}

function nuova(q: string, indici: Indice[], perId: Map<string, Voce>): Voce[] {
  const parole = paroleDi(q);
  if (parole.length === 0) return [];
  return indici
    .map((i) => ({ i, p: punteggio(i, parole) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .map((x) => perId.get(x.i.id)!);
}

async function main() {
  const elenco = await carica(await login());
  const perId = new Map(elenco.map((v) => [v.id, v]));
  const indici = elenco.map((v) => indicizza(v));
  console.log(`\n${elenco.length} giocatori, ${elenco.filter((v) => v.fullName).length} con nome completo.\n`);

  // Le prove nascono dal listone stesso: per ogni giocatore identificato si
  // prova a cercarlo come lo cercheresti davvero. Cosi' non si misura su una
  // manciata di casi scelti da me, ma su tutti.
  type Modo = { nome: string; query: (v: Voce) => string | null };
  const modi: Modo[] = [
    {
      nome: "il cognome, come sta sul listone",
      query: (v) => v.name.split(/[\s.]/)[0] || null,
    },
    {
      nome: "il nome di battesimo (non e' sul listone)",
      query: (v) => {
        if (!v.fullName) return null;
        const parti = v.fullName.split(/\s+/).filter(Boolean);
        return parti.length >= 2 ? parti[0] : null;
      },
    },
    {
      nome: "nome di battesimo + squadra",
      query: (v) => {
        if (!v.fullName) return null;
        const parti = v.fullName.split(/\s+/).filter(Boolean);
        return parti.length >= 2 ? `${parti[0]} ${v.team}` : null;
      },
    },
    {
      nome: "cognome + squadra",
      query: (v) => {
        const c = v.name.split(/[\s.]/)[0];
        return c ? `${c} ${v.team}` : null;
      },
    },
    {
      nome: "cognome con una lettera sbagliata",
      query: (v) => {
        const c = v.name.split(/[\s.]/)[0];
        if (!c || c.length < 5) return null;
        const i = Math.floor(c.length / 2);
        return c.slice(0, i) + (c[i] === "a" ? "e" : "a") + c.slice(i + 1);
      },
    },
  ];

  console.log("come lo cerchi                            | al primo posto | fra i primi 5 | trovato");
  for (const modo of modi) {
    let primo = 0;
    let cinque = 0;
    let dentro = 0;
    let prove = 0;
    let vPrimo = 0;
    let vCinque = 0;
    for (const v of elenco) {
      const q = modo.query(v);
      if (!q) continue;
      prove++;
      const r = nuova(q, indici, perId);
      const pos = r.findIndex((x) => x.id === v.id);
      if (pos === 0) primo++;
      if (pos >= 0 && pos < 5) cinque++;
      if (pos >= 0) dentro++;
      const rv = vecchia(q, elenco);
      const posV = rv.findIndex((x) => x.id === v.id);
      if (posV === 0) vPrimo++;
      if (posV >= 0 && posV < 5) vCinque++;
    }
    const pc = (x: number) => `${((100 * x) / Math.max(1, prove)).toFixed(0)}%`;
    console.log(
      `  ${modo.nome.padEnd(40)}|      ${pc(primo).padStart(5)}    |     ${pc(cinque).padStart(5)}   |  ${pc(dentro)}` +
        `      (prima: ${pc(vPrimo)} / ${pc(vCinque)}, su ${prove} prove)`,
    );
  }

  // Il caso che spiega perche' le informazioni vanno incrociate.
  console.log("\nincrociare nome e squadra restringe davvero?\n");
  for (const q of ["martinez", "martinez inter", "roma", "romagnoli", "paz", "paz como"]) {
    const r = nuova(q, indici, perId).slice(0, 3);
    console.log(
      `  "${q}"`.padEnd(22) +
        `${nuova(q, indici, perId).length.toString().padStart(4)} risultati  ->  ` +
        r.map((v) => `${v.name} (${v.team})`).join(", "),
    );
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
