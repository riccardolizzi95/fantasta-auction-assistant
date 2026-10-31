/**
 * I file per FantaAstaLive li rilegge il loro lettore, non il nostro.
 *
 * Lo stesso errore che e' gia' costato un bug in produzione — uno script che
 * riscrive la logica invece di chiamarla — qui non si puo' evitare chiamando
 * l'originale: il lettore di FantaAstaLive gira nel loro browser e non si puo'
 * importare. La cosa piu' vicina al percorso vero e' **trascriverlo**, e questo
 * file lo fa: `leggeLista` e `leggeRose` sono la traduzione leggibile, riga per
 * riga, delle funzioni del loro bundle del 11/09/2026 (`chunk-ASZNHTEF.js`,
 * funzioni `so`/`oo`, e `chunk-QQVPDJ2F.js`, funzione `E_`).
 *
 * Quindi: se cambiamo noi, il controllo fallisce subito. Se cambiano loro, la
 * trascrizione va rifatta — e il posto dove guardare e' scritto qui sopra.
 */
import {
  abbinaSquadre,
  csvListaCalciatori,
  csvRose,
  leggiRose,
  rigaCalciatore,
  savSquadre,
} from "../src/lib/fanta/fantaastalive";
import {
  CHIUSURA_ROSA,
  FINE_ROSA,
  NOME_DI_ROSA,
  PASTIGLIA,
  SOLO_CIFRE,
  coppieDiRosa,
  preferitoDelPonte,
} from "../src/lib/fanta/ponte";
import type { ParticipantRow, PlayerWithStats, Role } from "../src/lib/fanta/types";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

// --- La loro lettura, trascritta ------------------------------------------

/** `Ir` nel loro bundle: i ruoli mantra, in ordine di indice. */
const MANTRA: Record<string, number> = {
  por: 1, dc: 2, b: 3, dd: 4, ds: 5, e: 6, m: 7, c: 8, w: 9, t: 10, a: 11, pc: 12,
};

/** `ao`: il ruolo classic diventa una "zona". */
function zonaClassic(r = ""): string | null {
  switch (r.toLowerCase()) {
    case "p": return "gk";
    case "d": return "def";
    case "c": return "mid";
    case "a": return "atk";
  }
  return null;
}

/** `so` + `oo`: righe spezzate sulle virgole, senza intestazione, senza escape. */
function leggeLista(testo: string) {
  return testo
    .split(/\n/)
    .map((r) => r.split(","))
    .filter((c) => c && Number(c[0]) > 0)
    .map((e, indice) => {
      const ruoliMantra = (e[4] ?? "").toLowerCase().split(";");
      return {
        index: indice,
        id: +e[0],
        name: e[1],
        fullName: e[2],
        zone: { classic: zonaClassic(e[3]) },
        roles: ruoliMantra,
        roleIndex: ruoliMantra.map((x) => MANTRA[x] ?? -1).sort((a, b) => b - a)[0],
        prices: [+e[5] || 0, +e[6] || 0, +e[7] || 0, +e[8] || 0],
        price: +e[5] || 0,
        team: e[9],
        championship: +e[21],
        gone: e[16] === "1",
        stats: {
          playeds: +e[19] || 0,
          avgGrade: +e[17] || 0,
          avgFantaGrade: +e[18] || 0,
          fmv: { classic: +e[10] || 0 },
        },
        colonne: e.length,
      };
    })
    .sort((a, b) => b.stats.fmv.classic - a.stats.fmv.classic);
}

/** `E_`: le rose a blocchi, con la squadra contata dalle righe `$` precedenti. */
function leggeRose(testo: string) {
  const righe = String(testo ?? "").split("\n");
  const squadre: Record<number, string> = {};
  const picks: { index: number; teamId: number; playerId: number; cost: number }[] = [];
  if (righe[0] !== "$,$,$") return null;
  righe.forEach((riga, i) => {
    if (riga[0] === "$") return;
    const campi = riga.split(",");
    const nome = (campi[0] ?? "").trim();
    if (!nome) return;
    const teamId = righe.slice(0, i).filter((x) => x.trim().startsWith("$")).length - 1;
    squadre[teamId] = nome;
    picks.push({ index: picks.length, teamId, playerId: +campi[1], cost: +campi[2] });
  });
  return { teams: Object.values(squadre), picks };
}

// --- Un listone di prova, con i casi che rompono -------------------------

function giocatore(
  id: number,
  nome: string,
  ruolo: Role,
  squadra: string,
  extra: Partial<PlayerWithStats> = {},
): PlayerWithStats {
  return {
    id: `u-${id}`,
    season: "2026-27",
    external_id: id,
    name: nome,
    team: squadra,
    role: ruolo,
    quotation_initial: 20,
    quotation_current: 22,
    fvm: 100,
    is_active: true,
    stats: null,
    history: [],
    identity: null,
    ...extra,
  } as PlayerWithStats;
}

const listone: PlayerWithStats[] = [
  giocatore(2170, "LAUTARO MARTINEZ", "A", "Inter", {
    fvm: 320,
    identity: {
      player_id: "u-2170",
      full_name: "Lautaro Javier Martinez",
      birth_year: 1997,
      nationality: "Argentina",
      confidence: "alta",
      note: null,
      debut_season: null,
      debut_club: null,
      debut_competition: null,
      source: "wikidata",
      model: null,
    },
    history: [
      {
        player_id: "u-2170",
        season: "2025-26",
        competition: "serie-a",
        matches: 33,
        minutes: 2700,
        avg_vote: 6.83,
        avg_fantavote: 8.91,
        goals: 21, assists: 5, own_goals: 0, yellow_cards: 4, red_cards: 0,
        pen_scored: 3, pen_missed: 1, pen_saved: 0, goals_conceded: 0, clean_sheets: 0,
      },
    ],
  }),
  giocatore(577, "DI GREGORIO", "P", "Juventus", { fvm: 120 }),
  // Il nome con la virgola: senza pulizia sposta tutte le colonne dopo.
  giocatore(4200, "BASTONI, ALESSANDRO", "D", "Inter", { fvm: 150 }),
  // Senza identificativo ufficiale non si puo' esportare: per loro non esiste.
  giocatore(0, "SENZA ID", "C", "Como", { external_id: null, fvm: 90 } as Partial<PlayerWithStats>),
];

console.log("\n== La lista calciatori, riletta dal loro lettore ==");
const csvLista = csvListaCalciatori(listone);
const letti = leggeLista(csvLista);

check("chi non ha l'identificativo ufficiale resta fuori", letti.length === 3, letti.length);
check(
  "ogni riga ha le ventidue colonne che si aspettano",
  letti.every((r) => r.colonne === 22),
  letti.map((r) => r.colonne),
);

const lautaro = letti.find((r) => r.id === 2170)!;
check("il nome arriva intero", lautaro.name === "LAUTARO MARTINEZ", lautaro.name);
check("e il nome completo viene dall'anagrafica", lautaro.fullName === "Lautaro Javier Martinez", lautaro.fullName);
check("il ruolo diventa la zona giusta", lautaro.zone.classic === "atk", lautaro.zone.classic);
check("il ruolo mantra e' riconosciuto", lautaro.roleIndex === MANTRA.pc, lautaro.roleIndex);
check("la squadra e' quella", lautaro.team === "Inter", lautaro.team);
// L'ordine delle due quotazioni non e' un dettaglio: il tabellone usa la prima
// come prezzo, e nel file vero di Fantacalcio.it la prima e' l'attuale.
check(
  "il prezzo e' la quotazione attuale, non quella iniziale",
  lautaro.price === 22 && lautaro.prices[1] === 20,
  lautaro.prices,
);
check("il campionato e' la Serie A", lautaro.championship === 21, lautaro.championship);
check("nessuno risulta ceduto", letti.every((r) => !r.gone));
check(
  "media voto, fantamedia e presenze vengono dall'ultima Serie A",
  lautaro.stats.avgGrade === 6.83 && lautaro.stats.avgFantaGrade === 8.91 && lautaro.stats.playeds === 33,
  lautaro.stats,
);

const bastoni = letti.find((r) => r.id === 4200)!;
check(
  "la virgola nel nome non sposta le colonne",
  bastoni.team === "Inter" && bastoni.zone.classic === "def" && bastoni.prices[0] === 22,
  { team: bastoni.team, zona: bastoni.zone.classic, prezzi: bastoni.prices },
);

check(
  "l'ordine e' per FVM, come il loro",
  letti[0].id === 2170 && letti[letti.length - 1].id === 577,
  letti.map((r) => r.id),
);

console.log("\n== Il FVM nostro cambia l'ordine del tabellone ==");
const valori = new Map([["u-2170", 90], ["u-577", 260], ["u-4200", 150]]);
const conNostro = leggeLista(csvListaCalciatori(listone, { fvm: "nostro", valori }));
check(
  "con il nostro valore il portiere passa davanti",
  conNostro[0].id === 577 && conNostro[0].stats.fmv.classic === 260,
  conNostro.map((r) => [r.id, r.stats.fmv.classic]),
);
check(
  "le quotazioni restano quelle ufficiali",
  conNostro.every((r) => r.prices[0] === 22),
  conNostro.map((r) => r.prices[0]),
);

console.log("\n== Confronto con una riga vera di Fantacalcio.it ==");
/**
 * Due righe copiate dal file che il sito accetta davvero
 * (`Lista-FantaAsta-Fantacalcio.csv`, scaricato l'11/09/2026). Servono a
 * fissare l'ordine delle colonne: se qualcuno lo cambia, qui si vede.
 */
const VERE = [
  "22,De Roon,Marten De Roon ,C,M;C,3,4,4,5,Roma,10,13,destro,Olanda,29/03/1991 00:00:00,https://content.fantacalcio.it/web/campioncini/21/card/22.png?v=819,0,0.0,0.0",
  "252,Biraghi,Cristiano Biraghi,D,B;Ds;E,1,2,1,2,Torino,5,6,sinistro,Italia,12/09/1992 00:00:00,https://content.fantacalcio.it/web/campioncini/21/card/252.png?v=819,0,0.0,0.0",
];
const vere = leggeLista(VERE.join("\n") + "\n");
check("il loro file si legge con la nostra trascrizione", vere.length === 2, vere.length);
const deRoon = vere.find((r) => r.id === 22)!;
check("prezzo = 3 (la quotazione attuale, prima colonna delle due)", deRoon.price === 3, deRoon.prices);
check("ruoli mantra separati dal ;", deRoon.roles.join(",") === "m,c", deRoon.roles);
check("FVM classic 10 e non 13", deRoon.stats.fmv.classic === 10, deRoon.stats.fmv.classic);

// La stessa riga, scritta da noi partendo dagli stessi dati: le colonne che
// sappiamo riempire devono venire identiche.
const nostroDeRoon = rigaCalciatore(
  giocatore(22, "De Roon", "C", "Roma", {
    role_mantra: ["M", "C"],
    quotation_current: 3,
    quotation_initial: 4,
    fvm: 10,
  } as Partial<PlayerWithStats>),
)!.split(",");
const loroDeRoon = VERE[0].split(",");
const COLONNE_NOSTRE = [0, 1, 3, 4, 5, 6, 9, 10];
check(
  "le colonne che sappiamo riempire escono identiche alle loro",
  COLONNE_NOSTRE.every((i) => nostroDeRoon[i] === loroDeRoon[i]),
  COLONNE_NOSTRE.filter((i) => nostroDeRoon[i] !== loroDeRoon[i]).map((i) => ({
    colonna: i,
    nostro: nostroDeRoon[i],
    loro: loroDeRoon[i],
  })),
);

console.log("\n== Le squadre, nel loro file di salvataggio ==");
/**
 * Il loro `decode`, trascritto: `JSON.parse(atob(testo))`. E il loro
 * `importAll` applica una chiave solo se c'e' — `"teams" in f` — dopo aver
 * controllato che `fileVer` non sia troppo vecchio.
 */
function leggeSav(testo: string) {
  const f = JSON.parse(Buffer.from(testo, "base64").toString("latin1"));
  if ((f?.fileVer ?? 0) < 1) return null; // minSavedFileVersion
  return f;
}
const sav = leggeSav(savSquadre(["Giorgio", "Mario", "Bianchi", "Tomàs, il Terzo"]));
check("il file di salvataggio si apre", sav != null);
check("porta le squadre e nient'altro", Object.keys(sav).sort().join(",") === "fileVer,teams,timestamp", Object.keys(sav));
check("le quattro squadre ci sono", sav.teams.length === 4, sav.teams.length);
check(
  "identificativi progressivi da zero, come li fa lui",
  sav.teams.every((t: { id: number }, i: number) => t.id === i),
  sav.teams.map((t: { id: number }) => t.id),
);
check(
  "ogni squadra ha nome, colore e icona",
  sav.teams.every((t: { name: string; color: string; icon: string }) => t.name && /^#[0-9a-f]{6}$/.test(t.color) && t.icon),
  sav.teams,
);
// Passando per btoa/atob, che lavorano a byte singoli, un accento scritto in
// UTF-8 tornerebbe indietro spezzato in due caratteri.
check("gli accenti sopravvivono al giro in base64", sav.teams[3].name === "Tomàs il Terzo", sav.teams[3].name);
check(
  "senza le chiavi delle impostazioni, che di la' non vanno toccate",
  !("settings" in sav) && !("options" in sav) && !("picks" in sav),
  Object.keys(sav),
);

console.log("\n== Dove finiscono i giocatori in una colonna ==");
/**
 * Le due disposizioni viste sul tabellone vero: con la barra nei contatori e
 * senza. Senza, il lettore proseguiva dentro i contatori e registrava
 * sessantacinque acquisti inesistenti.
 */
const conBarra = ["Giorgio","Gila","35","Theate","400","Gagliardini","10","0","/6","2","/8","3","445","Budget","387","Max"];
const senzaBarra = ["Giorgio","Gila","35","Theate","400","Gagliardini","10","0","6","2","8","3","445","Budget"];
const conPastiglia = ["Giorgio","D","Gila","35","D","Theate","400","C","Gagliardini","10","0","6","2","8","3","445","Budget"];
const vuota = ["Mario","Nessun calciatore presente","0","6","0","8"];
const soloContatori = ["Sq","0","6","2","8","0","3"];
const atteso = JSON.stringify([
  { nome: "Gila", prezzo: 35 },
  { nome: "Theate", prezzo: 400 },
  { nome: "Gagliardini", prezzo: 10 },
]);
check("con la barra nei contatori", JSON.stringify(coppieDiRosa(conBarra, 1)) === atteso, coppieDiRosa(conBarra, 1));
check("e anche senza la barra", JSON.stringify(coppieDiRosa(senzaBarra, 1)) === atteso, coppieDiRosa(senzaBarra, 1));
check(
  "e con la pastiglia del ruolo davanti al nome",
  JSON.stringify(coppieDiRosa(conPastiglia, 1)) === atteso,
  coppieDiRosa(conPastiglia, 1),
);
check("una rosa vuota non inventa niente", coppieDiRosa(vuota, 1).length === 0, coppieDiRosa(vuota, 1));
check("i soli contatori non sono giocatori", coppieDiRosa(soloContatori, 1).length === 0, coppieDiRosa(soloContatori, 1));
check(
  "il bilancio chiude la colonna",
  coppieDiRosa(["Sq", "Gila", "35", "Budget", "387", "Max"], 1).length === 1,
  coppieDiRosa(["Sq", "Gila", "35", "Budget", "387", "Max"], 1),
);
/**
 * Il preferito e' una riga sola, e questo rende velenoso qualunque `\n` dentro
 * una stringa: diventa un ritorno a capo vero, e la compressione lo trasforma
 * in uno spazio. E' cosi' che `split` per righe e' diventato `split` per spazi,
 * e le rose si leggevano come una riga unica. Meglio un controllo che la
 * memoria.
 */
const codicePonte = decodeURIComponent(
  preferitoDelPonte("https://e.test", "l", "s".repeat(30)).slice("javascript:".length),
);
check("nessuno split sugli spazi", !codicePonte.includes("split(' ')"), codicePonte.match(/split\([^)]*\)/g));
check(
  "le righe si spezzano su un a-capo costruito, non scritto",
  codicePonte.includes("String.fromCharCode(10)"),
);
check(
  "e nessuna stringa contiene un a-capo vero",
  !/'[^']*\n[^']*'/.test(codicePonte),
);
check(
  "gli errori vengono spediti, non solo mostrati",
  codicePonte.includes("riporta({errore"),
);

check(
  "e le regole finiscono davvero nel preferito",
  preferitoDelPonte("https://e.test", "l", "s".repeat(30)).includes(encodeURIComponent("[a-zA-Z]")),
);

console.log("\n== Le rose vere, come le ha mandate il tabellone ==");
/**
 * Non un esempio inventato: e' la diagnosi che il ponte ha spedito dal
 * tabellone il 12/09/2026, con otto acquisti a schermo. Serve a fissare la
 * forma vera, perche' le mie ipotesi su come fosse fatta si sono sbagliate sei
 * volte di fila.
 */
const COLONNE_VERE: Record<string, string> = {
  Giorgio: "Giorgio\nGila\n35\nTheate\n400\nGagliardini\n10\n0\n/6\n2\n/8\n0\n/3\n1\n/8\n3\n55\nBudget\n34\nMax",
  Mario: "Mario\n\nNessun calciatore presente\n\n0\n/6\n0\n/8\n0\n/3\n0\n/8\n0\n500\nBudget\n476\nMax",
  Bianchi: "Bianchi\nFranjic\n5\nFrattesi\n100\nBonny\n5\n1\n/6\n1\n/8\n0\n/3\n1\n/8\n3\n390\nBudget\n369\nMax",
  Test_Base: "Test_Base\nOrsolini\n90\n0\n/6\n0\n/8\n0\n/3\n1\n/8\n1\n410\nBudget\n387\nMax",
  Test_Premium: "Test_Premium\nPadelli\n80\n0\n/6\n0\n/8\n1\n/3\n0\n/8\n1\n420\nBudget\n397\nMax",
};
const letteVere: Record<string, { nome: string; prezzo: number }[]> = {};
for (const [sq, testo] of Object.entries(COLONNE_VERE)) {
  const righe = testo.split("\n").map((x) => x.trim()).filter(Boolean);
  letteVere[sq] = coppieDiRosa(righe, righe.indexOf(sq) + 1);
}
const quanti = Object.values(letteVere).reduce((a, x) => a + x.length, 0);
check("gli otto acquisti veri si leggono tutti", quanti === 8, quanti);
check(
  "Giorgio: Gila 35, Theate 400, Gagliardini 10",
  JSON.stringify(letteVere.Giorgio) ===
    JSON.stringify([
      { nome: "Gila", prezzo: 35 },
      { nome: "Theate", prezzo: 400 },
      { nome: "Gagliardini", prezzo: 10 },
    ]),
  letteVere.Giorgio,
);
check("una rosa vuota resta vuota", letteVere.Mario.length === 0, letteVere.Mario);
check(
  "e il bilancio non diventa un giocatore",
  Object.values(letteVere).every((r) => r.every((x) => !/^(Budget|Max)$/.test(x.nome))),
);

console.log("\n== Il preferito del ponte ==");
/**
 * Un preferito e' una riga sola. Se dentro resta un commento, tutto quello che
 * viene dopo sparisce — e il ponte si installerebbe senza dare segno di niente.
 */
const preferito = preferitoDelPonte("https://esempio.test", "lega-1", "segreto-lungo-abcdefghijklmn");
check("comincia con javascript:", preferito.startsWith("javascript:"), preferito.slice(0, 20));
const codice = decodeURIComponent(preferito.slice("javascript:".length));
check("e' una riga sola", !codice.includes("\n"), codice.split("\n").length);
// Le due barre di `https://` non sono un commento: conta solo quello che non
// segue i due punti di uno schema.
const commento = /(^|[^:])\/\//.exec(codice);
check("senza commenti che mangerebbero il resto", commento === null, commento?.[0]);
let sintassi = "";
try {
  new Function(codice);
} catch (e) {
  sintassi = (e as Error).message;
}
check("ed e' codice valido", sintassi === "", sintassi);
check("porta indirizzo e segreto della lega",
  codice.includes("https://esempio.test/api/lega/lega-1/fantaastalive/live") &&
    codice.includes("segreto-lungo-abcdefghijklmn"));

check(
  "si rifiuta di partire fuori da FantaAstaLive",
  codice.includes("location.hostname!==") && codice.includes("fanta-asta-live.fantacalcio.it"),
);

console.log("\n== Le rose, andata e ritorno ==");
const testoRose = csvRose([
  { nome: "Gli Invincibili", acquisti: [{ playerId: 2170, prezzo: 180 }, { playerId: 577, prezzo: 22 }] },
  { nome: "Giorgio, il Magnifico", acquisti: [{ playerId: 4200, prezzo: 45 }] },
  { nome: "Chi non ha ancora comprato", acquisti: [] },
]);
const roseLette = leggeRose(testoRose);
check("il file e' nel formato che riconoscono", roseLette != null);
/**
 * La squadra che non ha comprato nessuno non si puo' scrivere, e non ci si
 * prova. Un segnaposto con identificativo 0 la creerebbe, ma porterebbe in
 * rosa un calciatore fantasma: ogni riga di giocatore, per loro, e' un
 * acquisto. Il loro export si comporta allo stesso modo.
 */
check("solo le squadre che hanno comprato qualcuno", roseLette?.teams.length === 2, roseLette?.teams);
check(
  "nessun acquisto fantasma con identificativo 0",
  roseLette?.picks.every((p) => p.playerId > 0) === true,
  roseLette?.picks,
);
check(
  "senza acquisti non esce nessun file",
  csvRose([{ nome: "Nessuno", acquisti: [] }]) === "",
  JSON.stringify(csvRose([{ nome: "Nessuno", acquisti: [] }])),
);
check(
  "la virgola nel nome della squadra non spezza la riga",
  roseLette?.teams[1] === "Giorgio il Magnifico",
  roseLette?.teams,
);
check(
  "prezzi e giocatori arrivano appaiati alla squadra giusta",
  roseLette?.picks.some((p) => p.teamId === 0 && p.playerId === 2170 && p.cost === 180) === true &&
    roseLette?.picks.some((p) => p.teamId === 1 && p.playerId === 4200 && p.cost === 45) === true,
  roseLette?.picks,
);

console.log("\n== Rileggere un file loro ==");
const daLoro = "$,$,$\nSquadra Uno,2170,180\nSquadra Uno,577,22\n$,$,$\nSquadra Due,4200,45\n";
const acquisti = leggiRose(daLoro);
check("il file di FantaAstaLive si legge", acquisti?.length === 3, acquisti?.length);
check(
  "squadra, giocatore e prezzo restano insieme",
  acquisti?.[0].squadra === "Squadra Uno" && acquisti?.[0].playerId === 2170 && acquisti?.[0].prezzo === 180,
  acquisti?.[0],
);
check("un file che non e' loro viene rifiutato", leggiRose("Id,Nome,Prezzo\n1,Tizio,10") === null);
check(
  "il segnaposto della squadra vuota non diventa un acquisto",
  leggiRose(testoRose)?.every((a) => a.playerId > 0) === true,
);

const partecipanti: ParticipantRow[] = [
  { id: "p1", league_id: "l", name: "Squadra Uno", user_id: null, budget_total: 500 },
  { id: "p2", league_id: "l", name: "squadra  due", user_id: null, budget_total: 500 },
];
const abbinate = abbinaSquadre(["Squadra Uno", "Squadra Due", "Terza"], partecipanti);
check("i nomi si abbinano anche scritti diversi", abbinate.get("Squadra Due")?.id === "p2", [...abbinate.keys()]);
check("una squadra che non esiste resta fuori", !abbinate.has("Terza"));

console.log("\n== Un giocatore senza niente ==");
const nudo = rigaCalciatore(giocatore(999, "IGNOTO", "C", "Lecce", { fvm: null, quotation_initial: null, quotation_current: null }));
const nudoLetto = leggeLista(`${nudo}\n`)[0];
check("esce comunque una riga leggibile", nudoLetto != null && nudoLetto.id === 999, nudo);
check("con la quotazione minima invece che zero", nudoLetto?.price === 1, nudoLetto?.price);

console.log("\n== Il piede di una colonna, come lo manda il tabellone ==");
/**
 * Queste righe sono uscite davvero dal tabellone, dalla diagnosi del ponte del
 * 13/09/2026. Stanno qui perche' la ricerca dei nomi delle squadre si ancora a
 * questa forma, e una prima versione la sbagliava: contando `FINE_ROSA` si
 * contavano due chiusure per colonna — "Budget" e "Max" — il blocco sembrava
 * contenere due squadre e veniva scartato, quindi non trovava niente.
 */
const colonnaVera = [
  "Giorgio",
  "Nessun calciatore presente",
  "0", "/6", "0", "/8", "0", "/3", "0", "/8",
  "0", "500", "Budget", "476", "Max",
];
check(
  "una colonna ha una sola riga di chiusura da contare",
  colonnaVera.filter((r) => CHIUSURA_ROSA.test(r)).length === 1,
  colonnaVera.filter((r) => CHIUSURA_ROSA.test(r)),
);
check(
  "ma due etichette da non scambiare per un nome",
  colonnaVera.filter((r) => FINE_ROSA.test(r)).length === 2,
  colonnaVera.filter((r) => FINE_ROSA.test(r)),
);
const nomeLetto = colonnaVera.find(
  (r) => !FINE_ROSA.test(r) && !SOLO_CIFRE.test(r) && !PASTIGLIA.test(r) && NOME_DI_ROSA.test(r),
);
check("il nome della squadra e' la prima riga buona", nomeLetto === "Giorgio", nomeLetto);

console.log(
  failures === 0 ? "\nTUTTI I CONTROLLI SUPERATI\n" : `\n${failures} CONTROLLI FALLITI\n`,
);
process.exit(failures === 0 ? 0 : 1);
