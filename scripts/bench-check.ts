/**
 * Quale configurazione conviene: modello, fornitore, motore di ricerca.
 *
 * Il progetto ha scelto il modello misurando, ma dava per scontato il resto — e
 * il resto e' la parte cara. Questo banco gira la stessa domanda in piu'
 * configurazioni e riporta, per ognuna, quanto costa, quanto ci mette e quanto
 * azzecca.
 *
 * La colonna che decide e' "web": OpenRouter riporta un costo unico, quindi la
 * quota della ricerca si ricava togliendo i token moltiplicati per il listino
 * vero del modello, preso dal loro stesso endpoint pubblico. E' l'unico modo di
 * sapere se conviene cambiare modello o cambiare motore.
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:bench
 *   GIRI=2 TAKE=10 npm run check:bench
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];
const TAKE = Number(process.env.TAKE || 10);
/** Quante volte ripetere la matrice. Uno non basta: un modello puo' azzeccare
 *  per caso, e questo progetto ci e' gia' cascato con GLM. */
const GIRI = Number(process.env.GIRI || 2);

const MODELLO_BASE = "google/gemini-2.5-flash-lite";

/** Filtro sulle etichette, per rigirare solo le configurazioni che interessano
 *  senza ripagare tutte le altre. `SOLO="exa,groq"`. */
const SOLO = (process.env.SOLO || "")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

/**
 * La matrice.
 *
 * Prima meta': stesso modello, motori diversi — misura la voce dominante.
 * Seconda meta': stesso motore, modelli diversi — misura quello che resta.
 * Cambiare una cosa per volta e' l'unico modo di attribuire la differenza.
 */
const MATRICE = [
  { label: "senza ricerca web", model: MODELLO_BASE, web: false },
  { label: "motore default ×5", model: MODELLO_BASE, maxResults: 5 },
  { label: "motore default ×10", model: MODELLO_BASE, maxResults: 10 },
  { label: "exa ×5", model: MODELLO_BASE, engine: "exa", maxResults: 5 },
  { label: "exa ×10", model: MODELLO_BASE, engine: "exa", maxResults: 10 },
  { label: "parallel ×5", model: MODELLO_BASE, engine: "parallel", maxResults: 5 },
  { label: "perplexity ×5", model: MODELLO_BASE, engine: "perplexity", maxResults: 5 },
  { label: "native ×5", model: MODELLO_BASE, engine: "native", maxResults: 5 },
  { label: "gpt-oss-20b", model: "openai/gpt-oss-20b", maxResults: 5 },
  { label: "mistral-nemo", model: "mistralai/mistral-nemo", maxResults: 5 },
  {
    label: "llama-3.3-70b via Groq",
    model: "meta-llama/llama-3.3-70b-instruct",
    maxResults: 5,
    provider: { order: ["Groq"], allow_fallbacks: false },
  },
  { label: "haiku 4.5 (il ripiego di oggi)", model: "anthropic/claude-haiku-4.5", maxResults: 5 },
];

const MATRICE_ATTIVA = SOLO.length
  ? MATRICE.filter((m) => SOLO.some((f) => m.label.toLowerCase().includes(f)))
  : MATRICE;

type Risultato = {
  label: string;
  model: string;
  ok: boolean;
  ms: number;
  cost?: number | null;
  promptTokens?: number;
  completionTokens?: number;
  servito?: string | null;
  troncata?: boolean;
  jsonValido?: boolean;
  trovati?: number;
  fiduciaAlta?: number;
  risposte?: { playerId: string; listone: string; nome: string | null; fiducia: string | null }[];
  error?: string;
};

/** Listino vero, dall'endpoint pubblico di OpenRouter. Nessuna chiave. */
async function listino(): Promise<Map<string, { in: number; out: number }>> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const { data } = (await res.json()) as {
    data: { id: string; pricing?: { prompt?: string; completion?: string } }[];
  };
  return new Map(
    data.map((m) => [
      m.id,
      { in: Number(m.pricing?.prompt ?? 0), out: Number(m.pricing?.completion ?? 0) },
    ]),
  );
}

async function login() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const session = await auth.json();
  if (!auth.ok) throw new Error(`login: ${JSON.stringify(session)}`);
  const raw = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const name = `sb-${REF}-auth-token`;
  const CHUNK = 3180;
  const parts: string[] = [];
  if (raw.length <= CHUNK) parts.push(`${name}=${raw}`);
  else
    for (let i = 0, k = 0; i < raw.length; i += CHUNK, k++)
      parts.push(`${name}.${k}=${raw.slice(i, i + CHUNK)}`);
  return parts.join("; ");
}

const soldi = (v: number) => `$${v.toFixed(5)}`;

async function main() {
  const [cookie, prezzi] = await Promise.all([login(), listino()]);

  // Gli stessi giocatori per tutti i giri: cambiando campione si misurerebbe la
  // fortuna invece della configurazione.
  const primo = await fetch(`${BASE}/api/model-bench`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ take: TAKE, runs: [MATRICE_ATTIVA[0]] }),
  });
  const avvio = await primo.json();
  if (!primo.ok) throw new Error(avvio.error ?? `HTTP ${primo.status}`);
  const playerIds: string[] = (avvio.players ?? []).map((p: { id: string }) => p.id);
  const campione: { id: string; name: string }[] = avvio.players ?? [];
  console.log(`Campione: ${campione.map((p) => p.name).join(", ")}\n`);

  const accumulo = new Map<string, Risultato[]>();
  for (const r of avvio.results as Risultato[]) accumulo.set(r.label, [r]);

  // A ondate piccole. Il primo tentativo mandava undici configurazioni insieme:
  // ognuna fa una ricerca web da dieci o venti secondi, la funzione ha sfondato
  // i 60 secondi del piano e la risposta e' andata persa — con il lavoro gia'
  // pagato. Le configurazioni sono indipendenti, quindi spezzarle non cambia
  // cosa si misura: cambia solo cosa si riesce a riportare a casa.
  const PER_ONDATA = 3;
  for (let giro = 1; giro <= GIRI; giro++) {
    const daFare = giro === 1 ? MATRICE_ATTIVA.slice(1) : MATRICE_ATTIVA;
    for (let i = 0; i < daFare.length; i += PER_ONDATA) {
      const ondata = daFare.slice(i, i + PER_ONDATA);
      const t0 = Date.now();
      let json: { results?: Risultato[]; consenso?: unknown; error?: string };
      try {
        const res = await fetch(`${BASE}/api/model-bench`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ playerIds, runs: ondata }),
        });
        json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      } catch (e) {
        // Un'ondata persa non deve buttare via le altre: si segna e si va avanti.
        console.log(
          `  giro ${giro}, ondata ${ondata.map((o) => o.label).join(" / ")}: ` +
            `persa dopo ${((Date.now() - t0) / 1000).toFixed(0)}s — ${(e as Error).message}`,
        );
        continue;
      }
      for (const r of json.results ?? []) {
        accumulo.set(r.label, [...(accumulo.get(r.label) ?? []), r]);
      }
      // Il consenso lo calcola questo script su tutte le configurazioni, non
      // l'endpoint su tre: `json.consenso` qui si ignora.
    }
  }
  mostraConsenso(accumulo, campione);

  console.log(
    "configurazione                    tempo    costo      token      web       json  trovati",
  );
  const righe: { label: string; costo: number; web: number; trovati: number }[] = [];
  for (const [label, prove] of accumulo) {
    const buone = prove.filter((p) => p.ok);
    if (buone.length === 0) {
      console.log(`${label.padEnd(33)} ${(prove[0].error ?? "fallita").slice(0, 60)}`);
      continue;
    }
    const media = (f: (r: Risultato) => number) =>
      buone.reduce((s, r) => s + f(r), 0) / buone.length;
    const costo = media((r) => Number(r.cost ?? 0));
    const p = prezzi.get(buone[0].model) ?? { in: 0, out: 0 };
    const token = media((r) => (r.promptTokens ?? 0) * p.in + (r.completionTokens ?? 0) * p.out);
    // Quello che resta dopo i token e' la ricerca: OpenRouter non la separa.
    const web = Math.max(0, costo - token);
    const trovati = media((r) => r.trovati ?? 0);
    const alta = media((r) => r.fiduciaAlta ?? 0);
    const jsonOk = buone.filter((r) => r.jsonValido).length;
    console.log(
      `${label.padEnd(33)} ${`${(media((r) => r.ms) / 1000).toFixed(1)}s`.padEnd(8)} ` +
        `${soldi(costo).padEnd(10)} ${soldi(token).padEnd(10)} ${soldi(web).padEnd(9)} ` +
        `${`${jsonOk}/${buone.length}`.padEnd(5)} ${trovati.toFixed(1)}/${TAKE} (alta ${alta.toFixed(1)})`,
    );
    righe.push({ label, costo, web, trovati });
  }

  const riferimento = righe.find((r) => r.label.startsWith("motore default"));
  if (riferimento) {
    console.log(`\nRispetto a "${riferimento.label}", per 130 giocatori da recuperare:`);
    for (const r of righe) {
      if (r === riferimento) continue;
      const delta = (r.costo - riferimento.costo) * 130;
      const segno = delta < 0 ? "risparmia" : "costa";
      console.log(
        `  ${r.label.padEnd(33)} ${segno} $${Math.abs(delta).toFixed(2)}  ` +
          `(trovati ${r.trovati.toFixed(1)} contro ${riferimento.trovati.toFixed(1)})`,
      );
    }
  }
}

/**
 * Dove le configurazioni non sono d'accordo.
 *
 * Si calcola qui e non nell'endpoint perche' l'endpoint ne vede tre per ondata:
 * un accordo fra tre configurazioni scelte dal caso non e' un accordo, e' un
 * campione. Qui ci sono tutte, di tutti i giri.
 *
 * Vale subito e vale dopo. Subito: un nome su cui concordano dodici
 * configurazioni diverse e' quasi certamente giusto, e uno su cui ognuna dice la
 * sua e' esattamente il caso che fa sbagliare l'asta. Dopo: e' il prototipo del
 * riscontro fra fonti indipendenti.
 */
function mostraConsenso(accumulo: Map<string, Risultato[]>, campione: { id: string; name: string }[]) {
  const normalizza = (v: string) =>
    v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").trim();

  console.log("\nDove le configurazioni non sono d'accordo:");
  let unanimi = 0;
  for (const giocatore of campione) {
    const detti = new Map<string, string[]>();
    for (const [label, prove] of accumulo) {
      for (const p of prove) {
        // Per id, non per posizione: e' l'errore che questo banco ha gia' fatto.
        const nome = p.risposte?.find((x) => x.playerId === giocatore.id)?.nome;
        if (!nome) continue;
        const chiave = normalizza(nome);
        if (!detti.has(chiave)) detti.set(chiave, []);
        if (!detti.get(chiave)!.includes(label)) detti.get(chiave)!.push(label);
      }
    }
    const varianti = [...detti.entries()].sort((a, b) => b[1].length - a[1].length);
    const risposte = varianti.reduce((n, v) => n + v[1].length, 0);
    if (varianti.length <= 1) {
      unanimi += 1;
      continue;
    }
    console.log(`  ${giocatore.name} — ${varianti[0][1].length}/${risposte} sul piu' votato`);
    for (const [nome, chi] of varianti) {
      console.log(`      ${nome.padEnd(28)} ${chi.length}×  ${chi.slice(0, 3).join(", ")}`);
    }
  }
  console.log(`  ...e ${unanimi} su cui nessuna si contraddice.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Senza un export questo file starebbe nello scope globale, e due script che
// dichiarano la stessa costante non compilerebbero insieme.
export {};
