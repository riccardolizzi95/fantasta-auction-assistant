/**
 * Verifica il lettore dei file ufficiali di Fantacalcio.it.
 *
 * Ricostruisce due file con la stessa forma di quelli veri — riga di titolo
 * sopra le intestazioni, nomi di colonna abbreviati — e controlla che vengano
 * riconosciuti, letti e agganciati al listone anche quando i nomi non
 * coincidono al carattere.
 */
import * as XLSX from "xlsx";
import {
  matchStatsToPlayers,
  parseWorkbook,
  stagioneDalNome,
  type ListPlayer,
} from "../src/lib/fanta/importer";
import { altezzaInCm } from "../src/lib/fanta/wikidata";
import { isFemminile } from "../src/lib/fanta/apiFootball";
import {
  abbinaRosa,
  punteggioSquadra,
  rubaIdentita,
  scomponiArchivio,
  scomponiListone,
  stessaSquadra,
} from "../src/lib/fanta/rosters";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

function build(sheetName: string, title: string, rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[title], ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

console.log("\n== File quotazioni ==");
const quotBuf = build("Tutti", "Quotazioni Fantacalcio Stagione 2026-27", [
  ["Id", "R", "RM", "Nome", "Squadra", "Qt.A", "Qt.I", "Diff.", "Qt.A M", "Qt.I M", "Diff.M", "FVM", "FVM M"],
  [2170, "A", "Pc", "LAUTARO MARTINEZ", "Inter", 32, 30, 2, 40, 38, 2, 320, 400],
  [577, "P", "Por", "DI GREGORIO", "Juventus", 16, 15, 1, 18, 17, 1, 120, 140],
  [4200, "D", "Dc;Ds", "BASTONI", "Inter", 18, 17, 1, 22, 21, 1, 150, 180],
  [2792, "C", "M;C", "BARELLA", "Inter", 20, 19, 1, 24, 23, 1, 170, 200],
  ["", "", "", "", "", "", "", "", "", "", "", "", ""],
]);
const quot = parseWorkbook(quotBuf);
check("riconosciuto come quotazioni", quot.kind === "quotazioni", quot.kind);
if (quot.kind === "quotazioni") {
  check("4 giocatori letti, riga vuota scartata", quot.players.length === 4, quot.players.length);
  const lautaro = quot.players.find((p) => p.name.includes("LAUTARO"))!;
  check("Id ufficiale letto", lautaro?.external_id === 2170, lautaro?.external_id);
  check("ruolo classic letto", lautaro?.role === "A", lautaro?.role);
  check("quotazione attuale letta (Qt.A)", lautaro?.quotation_current === 32, lautaro?.quotation_current);
  check("quotazione iniziale letta (Qt.I)", lautaro?.quotation_initial === 30, lautaro?.quotation_initial);
  check("fantavalore letto", lautaro?.fvm === 320, lautaro?.fvm);
  check("ruoli mantra separati dal ;", quot.players.find((p) => p.name === "BASTONI")?.role_mantra.join(",") === "Dc,Ds");
}

console.log("\n== File statistiche ==");
const statBuf = build("Tutti", "Statistiche Fantacalcio Stagione 2025-26", [
  ["Id", "R", "Rm", "Nome", "Squadra", "Pv", "Mv", "Fm", "Gf", "Gs", "Rp", "Rc", "R+", "R-", "Ass", "Amm", "Esp", "Au"],
  [2170, "A", "Pc", "LAUTARO MARTINEZ", "Inter", 33, 6.55, 8.12, 18, 0, 0, 0, 4, 1, 5, 4, 0, 0],
  [577, "P", "Por", "DI GREGORIO", "Juventus", 36, 6.05, 5.28, 0, 38, 2, 0, 0, 0, 0, 2, 0, 0],
  [4200, "D", "Dc", "BASTONI", "Inter", 30, 6.18, 6.51, 2, 0, 0, 0, 0, 0, 3, 7, 1, 0],
  [2792, "C", "M", "BARELLA", "Inter", 31, 6.22, 6.74, 4, 0, 0, 0, 0, 0, 6, 9, 0, 1],
]);
const stat = parseWorkbook(statBuf);
check("riconosciuto come statistiche", stat.kind === "statistiche", stat.kind);
if (stat.kind === "statistiche") {
  check("4 righe lette", stat.stats.length === 4, stat.stats.length);
  const l = stat.stats.find((s) => s.name.includes("LAUTARO"))!;
  check("presenze a voto (Pv)", l?.matches === 33, l?.matches);
  check("media voto (Mv)", l?.avg_vote === 6.55, l?.avg_vote);
  check("fantamedia (Fm)", l?.avg_fantavote === 8.12, l?.avg_fantavote);
  check("gol fatti (Gf)", l?.goals === 18, l?.goals);
  check("assist (Ass)", l?.assists === 5, l?.assists);
  check("rigori segnati (R+)", l?.pen_scored === 4, l?.pen_scored);
  check("rigori sbagliati (R-)", l?.pen_missed === 1, l?.pen_missed);
  const gk = stat.stats.find((s) => s.role === "P")!;
  check("gol subiti (Gs)", gk?.goals_conceded === 38, gk?.goals_conceded);
  check("rigori parati (Rp)", gk?.pen_saved === 2, gk?.pen_saved);
  const bast = stat.stats.find((s) => s.name === "BASTONI")!;
  check("espulsioni (Esp)", bast?.red_cards === 1, bast?.red_cards);
  check("autoreti (Au)", stat.stats.find((s) => s.name === "BARELLA")?.own_goals === 1);
}

console.log("\n== Forzare il tipo a mano ==");
const forced = parseWorkbook(statBuf, "statistiche");
check("il tipo imposto viene rispettato", forced.kind === "statistiche");

console.log("\n== Abbinamento al listone ==");
const listone: ListPlayer[] = [
  { id: "a", external_id: 2170, name: "LAUTARO MARTINEZ", team: "Inter" },
  // Id cambiato fra le due stagioni: deve trovarlo per nome + squadra
  { id: "b", external_id: 9999, name: "DI GREGORIO", team: "Juventus" },
  // Nome con accento e punteggiatura diversi: deve normalizzare
  { id: "c", external_id: null, name: "Bastòni A.", team: "Inter" },
  // Cambio squadra: nome unico, deve bastare
  { id: "d", external_id: null, name: "BARELLA", team: "Napoli" },
];
if (stat.kind === "statistiche") {
  const withOddNames = stat.stats.map((s) =>
    s.name === "BASTONI" ? { ...s, name: "Bastòni A." } : s,
  );
  const res = matchStatsToPlayers(withOddNames, listone);
  check("tutti abbinati", res.unmatched.length === 0, res.unmatched);
  check("uno per Id ufficiale", res.matchedBy.id === 1, res.matchedBy);
  check("due per nome + squadra", res.matchedBy.nameTeam === 2, res.matchedBy);
  check("uno per solo nome (cambio squadra)", res.matchedBy.name === 1, res.matchedBy);

  const orphan = matchStatsToPlayers(
    [{ ...stat.stats[0], external_id: 1, name: "SCONOSCIUTO", team: "Boh" }],
    listone,
  );
  check("chi non c'e' in listone finisce fra i non abbinati", orphan.unmatched.length === 1, orphan);
}

console.log("\n== File illeggibile ==");
try {
  parseWorkbook(build("Foglio1", "Roba a caso", [["a", "b"], [1, 2]]));
  check("un file senza colonne note viene rifiutato", false);
} catch (e) {
  check("un file senza colonne note viene rifiutato", true, (e as Error).message.slice(0, 60));
}

console.log("\n== Come si legge un nome del listone ==");
const L = (n: string) => scomponiListone(n);
check('"Ramos G." -> ramos + g', L("Ramos G.").cognome === "ramos" && L("Ramos G.").iniziale === "g", L("Ramos G."));
check('"Vicario" -> cognome solo', L("Vicario").cognome === "vicario" && L("Vicario").iniziale === null);
check('"Caleta-Car" resta intero', L("Caleta-Car").cognome === "caleta-car", L("Caleta-Car"));
check('"Chalobah T." -> chalobah + t', L("Chalobah T.").cognome === "chalobah" && L("Chalobah T.").iniziale === "t");
check('"Sanchez Ro." usa l abbreviazione come iniziale', L("Sanchez Ro.").cognome === "sanchez" && L("Sanchez Ro.").iniziale === "r", L("Sanchez Ro."));

check('"N\'Dicka" e "Ndicka" sono lo stesso cognome',
  L("N'Dicka").cognome === scomponiArchivio({ name: "E. Ndicka" }).cognome,
  [L("N'Dicka").cognome, scomponiArchivio({ name: "E. Ndicka" }).cognome]);
check('"N\'Dri" regge lo stesso trattamento',
  L("N'Dri").cognome === scomponiArchivio({ name: "N'Dri" }).cognome);

console.log("\n== Come si legge un nome dell archivio ==");
const A = scomponiArchivio;
check("campi separati vincono", A({ firstname: "John", lastname: "Stones" }).nome === "John");
check('"J. Stones" non spaccia l iniziale per un nome',
  A({ name: "J. Stones" }).cognome === "stones" && A({ name: "J. Stones" }).nome === null,
  A({ name: "J. Stones" }));
check('"Arthur Theate" da il nome per esteso',
  A({ name: "Arthur Theate" }).nome === "Arthur" && A({ name: "Arthur Theate" }).cognome === "theate");
console.log("\n== Lettere che l accento non spiega ==");
const cog = (n: string) => scomponiArchivio({ name: n }).cognome;
check('Yıldız -> yildiz', cog("Kenan Yıldız") === "yildiz", cog("Kenan Yıldız"));
check('Bobček -> bobcek', cog("Matus Bobček") === "bobcek", cog("Matus Bobček"));
check('Østigård -> ostigard', cog("Leo Østigård") === "ostigard", cog("Leo Østigård"));
check('Bragança -> braganca', cog("Tiago Bragança") === "braganca", cog("Tiago Bragança"));
check('Adžić -> adzic', cog("Vasilije Adžić") === "adzic", cog("Vasilije Adžić"));
check('Łukasz -> il cognome resta pulito', cog("Łukasz Skorupski") === "skorupski");
check("e il listone senza accenti ci arriva uguale",
  scomponiListone("Yildiz").cognome === cog("Kenan Yıldız"));

check('"Kevin De Bruyne" tiene la particella nel cognome',
  A({ name: "Kevin De Bruyne" }).cognome === "de bruyne", A({ name: "Kevin De Bruyne" }));

console.log("\n== Abbinare il listone alla rosa ufficiale ==");
const rosa = [
  { id: "1", name: "J. Stones" },
  { id: "2", firstname: "Goncalo", lastname: "Ramos" },
  { id: "3", firstname: "Sergio", lastname: "Ramos" },
  { id: "4", firstname: "Nahuel", lastname: "Molina" },
  { id: "5", firstname: "Nicolas", lastname: "Molina" },
];
const esito = abbinaRosa(
  [
    { id: "a", name: "Stones", team: "Inter" },
    { id: "b", name: "Ramos G.", team: "Inter" },
    { id: "c", name: "Molina", team: "Inter" },
    { id: "d", name: "Osimhen", team: "Inter" },
  ],
  rosa,
);
check("un cognome unico basta, senza iniziale",
  esito.trovati.find((t) => t.playerId === "a")?.id === "1");
check("due omonimi li separa l iniziale del listone",
  esito.trovati.find((t) => t.playerId === "b")?.id === "2", esito.trovati);
check("due omonimi senza iniziale restano ambigui, e non si tira a indovinare",
  esito.ambigui.some((x) => x.playerId === "c") && !esito.trovati.some((t) => t.playerId === "c"),
  esito.ambigui);
check("chi non e in rosa risulta mancante", esito.mancanti.some((x) => x.playerId === "d"));
check("il nome per esteso arriva quando l archivio ce l ha",
  esito.trovati.find((t) => t.playerId === "b")?.fullName === "Goncalo Ramos");
check("e resta vuoto quando l archivio abbrevia",
  esito.trovati.find((t) => t.playerId === "a")?.fullName === null,
  esito.trovati.find((t) => t.playerId === "a"));

console.log("\n== Altezze scritte in due unita' diverse ==");
check("1.86 sono 186 centimetri", altezzaInCm(1.86) === 186);
check("186 restano 186", altezzaInCm(186) === 186);
check("18600 non e un altezza", altezzaInCm(18600) === null);
check("zero non e un altezza", altezzaInCm(0) === null);

console.log("\n== Squadre femminili, che l archivio segna solo col nome ==");
check('"Roma W" e femminile', isFemminile("Roma W"));
check('"Juventus Women" e femminile', isFemminile("Juventus Women"));
check('"AS Roma" non lo e', !isFemminile("AS Roma"));
check('"Torino" non lo e', !isFemminile("Torino"));
check('una W dentro il nome non basta', !isFemminile("Werder Brema"));

console.log("\n== Un nome che appartiene a un altro della rosa ==");
// Gli **altri** dell'Atalanta: chi chiama esclude sempre se stesso.
const altriAtalanta = [{ name: "Carnesecchi" }, { name: "Sportiello" }];
check('"Pompei" non puo diventare "Marco Carnesecchi": Carnesecchi e un altro',
  rubaIdentita("Marco Carnesecchi", altriAtalanta) === "Carnesecchi");
check("un nome che non e di nessun altro passa",
  rubaIdentita("Marco Pompei", altriAtalanta) === null);
check("i soprannomi sudamericani restano: Beto -> Norberto Betuncal",
  rubaIdentita("Norberto Bercique Gomes Betuncal", [{ name: "Beto" }, { name: "Dodò" }]) === null);
check("Goncalo Ramos passa: fra gli altri della rosa non c e un Ramos",
  rubaIdentita("Goncalo Ramos", [{ name: "Leao" }, { name: "Pulisic" }]) === null);
check("ma se un altro Ramos nella rosa c e davvero, viene fermato",
  rubaIdentita("Sergio Ramos", [{ name: "Ramos" }, { name: "Leao" }]) === "Ramos");

console.log("\n== Nomi di squadra ==");
check("Inter e Internazionale sono la stessa", stessaSquadra("Inter", "FC Internazionale"));
check("Milan e AC Milan sono la stessa", stessaSquadra("Milan", "AC Milan"));
check("Verona e Hellas Verona sono la stessa", stessaSquadra("Verona", "Hellas Verona"));
check("Inter e Milan non lo sono", !stessaSquadra("Inter", "Milan"));
check("Roma e Cremonese non lo sono", !stessaSquadra("Roma", "Cremonese"));

console.log("\n== Fra piu' Roma vince quella giusta ==");
const pt = (a: string) => punteggioSquadra("Roma", a);
check('"AS Roma" e la Roma', pt("AS Roma") === 3, pt("AS Roma"));
check('"Romana" ci somiglia soltanto', pt("Romana") === 2, pt("Romana"));
check("e l uguaglianza batte la somiglianza", pt("AS Roma") > pt("Romana"));
check('"Hellas Verona" per "Verona" vale 2',
  punteggioSquadra("Verona", "Hellas Verona") === 2);
check('"Bologna FC 1909" e il Bologna',
  punteggioSquadra("Bologna", "Bologna FC 1909") === 3,
  punteggioSquadra("Bologna", "Bologna FC 1909"));
check('"SSC Napoli" e il Napoli', punteggioSquadra("Napoli", "SSC Napoli") === 3);
check("Inter e Milan restano estranee", punteggioSquadra("Inter", "AC Milan") === 0);

console.log("\n== La stagione la dice il nome del file ==");
//
// E' successo davvero: un file del 2026-27 caricato con la tendina ferma sul
// 2022-23 ha sovrascritto un'annata intera. Il nome lo scrive il sito, la
// tendina la lascia dov'era chi carica.
check("Statistiche_Fantacalcio_Stagione_2026_27.xlsx -> 2026-27",
  stagioneDalNome("Statistiche_Fantacalcio_Stagione_2026_27.xlsx") === "2026-27");
check("Quotazioni_Fantacalcio_Stagione_2025_26.xlsx -> 2025-26",
  stagioneDalNome("Quotazioni_Fantacalcio_Stagione_2025_26.xlsx") === "2025-26");
check("regge anche la copia scaricata due volte",
  stagioneDalNome("Statistiche_Fantacalcio_Stagione_2024_25 (2).xlsx") === "2024-25");
check("e le quattro cifre per intero",
  stagioneDalNome("Statistiche 2023-2024.xlsx") === "2023-24");
check("due anni che non si seguono non sono una stagione",
  stagioneDalNome("Statistiche_2026_31.xlsx") === null);
check("un nome senza anno non inventa niente",
  stagioneDalNome("statistiche.xlsx") === null,
  stagioneDalNome("statistiche.xlsx"));

console.log(failures === 0 ? "\nTUTTI I CONTROLLI SUPERATI\n" : `\n${failures} CONTROLLI FALLITI\n`);
process.exit(failures === 0 ? 0 : 1);
