/**
 * Verifica la conversione delle statistiche da altri campionati.
 * Nessuna rete, nessun database: solo il modello.
 */
import {
  competitionByKey,
  ratingToMediaVoto,
  resolveCompetition,
  shouldSkipCompetition,
} from "../src/lib/fanta/competitions";
import {
  expectedConcededPerGame,
  normalizeHistory,
  toSerieAEquivalent,
} from "../src/lib/fanta/conversion";
import { buildValuations } from "../src/lib/fanta/valuation";
import { dropWhereBetterExists, mergeDuplicates, type StatRow } from "../src/lib/fanta/externalStats";
import { isExpansionOf } from "../src/lib/fanta/reliability";
import { coerente, incoerenze, separaIncoerenti } from "../src/lib/fanta/coherence";
import {
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  ROLE_BASELINE_MV,
  SEASON_WEIGHTS,
  type PlayerStatsRow,
  type PlayerWithStats,
  type Role,
} from "../src/lib/fanta/types";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

function stats(over: Partial<PlayerStatsRow> = {}): PlayerStatsRow {
  return {
    player_id: "x", season: "2025-26", competition: "serie-a", matches: 34, minutes: 2900,
    avg_vote: null, avg_fantavote: null, goals: 0, assists: 0, own_goals: 0,
    yellow_cards: 4, red_cards: 0, pen_scored: 0, pen_missed: 0, pen_saved: 0,
    goals_conceded: 0, clean_sheets: 0, ...over,
  };
}

console.log("\n== Riconoscimento del campionato ==");
check("Serie A italiana", resolveCompetition("Serie A", "Italy").key === "serie-a");
check(
  "Serie A brasiliana non e' la nostra",
  resolveCompetition("Serie A", "Brazil").key === "brasileirao",
  resolveCompetition("Serie A", "Brazil").key,
);
check("Premier League", resolveCompetition("Premier League", "England").key === "premier-league");
check("Eredivisie", resolveCompetition("Eredivisie", "Netherlands").key === "eredivisie");
check("Serie B", resolveCompetition("Serie B", "Italy").key === "serie-b");
check("Segunda Division spagnola", resolveCompetition("Segunda División", "Spain").key === "la-liga-2");
check(
  "campionato ignoto -> fascia prudente",
  resolveCompetition("Liga Kazakistan Premier", "Kazakhstan").key === "sconosciuta",
);
check("produzione Serie A = 1", competitionByKey("serie-a").production === 1);
check("Serie B vale meno della Premier",
  competitionByKey("serie-b").production < competitionByKey("premier-league").production);

console.log("\n== Conversione della produzione ==");
const A: Role = "A";
const eredivisie = toSerieAEquivalent(
  stats({ competition: "eredivisie", goals: 20, assists: 6, rating: 7.4 }), A,
);
check("20 gol in Eredivisie diventano circa 12", Math.round(eredivisie.goals) === 12, eredivisie.goals);
check("gli assist scalano allo stesso modo", Math.abs(eredivisie.assists - 6 * 0.62) < 0.01, eredivisie.assists);
check("il campione vale meno di uno di Serie A", eredivisie.weightFactor < 1, eredivisie.weightFactor);
check("viene marcato come convertito", eredivisie.converted === true);

const premier = toSerieAEquivalent(stats({ competition: "premier-league", goals: 15, rating: 7.4 }), A);
check("in Premier i gol non vengono scalati", premier.goals === 15, premier.goals);

const serieB = toSerieAEquivalent(stats({ competition: "serie-b", goals: 15, rating: 7.2 }), A);
check("15 gol in Serie B valgono meno di 15 in Premier", serieB.goals < premier.goals, serieB.goals);
check("e anche meno di 15 in Eredivisie a parita' di gol",
  serieB.goals < toSerieAEquivalent(stats({ competition: "eredivisie", goals: 15 }), A).goals);

console.log("\n== Ricostruzione della fantamedia ==");
check("un rating estero sopra la media alza la media voto italiana",
  (ratingToMediaVoto(7.4, A) ?? 0) > ROLE_BASELINE_MV.A, ratingToMediaVoto(7.4, A));
check("un rating medio da' esattamente la media di ruolo",
  Math.abs((ratingToMediaVoto(6.8, A) ?? 0) - ROLE_BASELINE_MV.A) < 0.01, ratingToMediaVoto(6.8, A));
check("un rating scarso la abbassa",
  (ratingToMediaVoto(6.2, A) ?? 0) < ROLE_BASELINE_MV.A, ratingToMediaVoto(6.2, A));
check("la fantamedia viene ricostruita quando manca",
  eredivisie.avg_fantavote != null && eredivisie.avg_fantavote > eredivisie.avg_vote!,
  eredivisie.avg_fantavote);
check("senza rating si parte dalla media di ruolo",
  toSerieAEquivalent(stats({ competition: "eredivisie", goals: 0, yellow_cards: 0 }), A).avg_vote
    === ROLE_BASELINE_MV.A);
check("una riga di Serie A non viene toccata",
  toSerieAEquivalent(stats({ avg_vote: 6.3, avg_fantavote: 7.9, goals: 14 }), A).goals === 14);

console.log("\n== Portiere da campionato debole ==");
const gk = toSerieAEquivalent(
  stats({ competition: "eredivisie", goals_conceded: 30, clean_sheets: 12, rating: 7.0 }), "P",
);
check("subirebbe piu' gol in Serie A", gk.goals_conceded > 30, gk.goals_conceded);
check("e terrebbe meno la porta inviolata", gk.clean_sheets < 12, gk.clean_sheets);

console.log("\n== Dati mancanti dalle fonti esterne ==");
const gkNoData = toSerieAEquivalent(
  stats({ competition: "premier-league", matches: 31, goals_conceded: 0, source: "ai" }), "P",
);
check("un portiere a zero gol subiti non e' imbattuto, e' un dato mancante",
  gkNoData.goals_conceded > 20, gkNoData.goals_conceded);
check("e la sua fantamedia non risulta gonfiata",
  (gkNoData.avg_fantavote ?? 0) < 5.6, gkNoData.avg_fantavote);
check("le fonti AI pesano meno di quelle verificabili",
  gkNoData.weightFactor < toSerieAEquivalent(
    stats({ competition: "premier-league", matches: 31, goals_conceded: 40, source: "api" }), "P",
  ).weightFactor);
check("una riga di Serie A senza fantamedia viene ricostruita",
  toSerieAEquivalent(stats({ goals: 10, source: "manual", avg_fantavote: null }), A).avg_fantavote != null);
check("il portiere che i gol subiti li ha davvero non viene toccato",
  Math.round(toSerieAEquivalent(
    stats({ competition: "premier-league", matches: 30, goals_conceded: 33 }), "P",
  ).goals_conceded) === 33);

console.log("\n== Portiere: conta la difesa di adesso, non quella di prima ==");
const forte = toSerieAEquivalent(
  stats({ competition: "premier-league", matches: 31, goals_conceded: 0 }), "P",
  expectedConcededPerGame(0.9),
);
const debole = toSerieAEquivalent(
  stats({ competition: "premier-league", matches: 31, goals_conceded: 0 }), "P",
  expectedConcededPerGame(0.1),
);
check("in una squadra forte si stimano meno gol subiti", forte.goals_conceded < debole.goals_conceded,
  [forte.goals_conceded.toFixed(0), debole.goals_conceded.toFixed(0)]);
check("e quindi una fantamedia migliore",
  (forte.avg_fantavote ?? 0) > (debole.avg_fantavote ?? 0),
  [forte.avg_fantavote?.toFixed(2), debole.avg_fantavote?.toFixed(2)]);
check("lo scarto fra le due e' quello vero della Serie A (circa un gol ogni tre gare)",
  Math.abs((forte.avg_fantavote ?? 0) - (debole.avg_fantavote ?? 0) - 0.83) < 0.15,
  ((forte.avg_fantavote ?? 0) - (debole.avg_fantavote ?? 0)).toFixed(2));
check("chi i gol subiti li ha davvero non viene ritoccato",
  Math.round(toSerieAEquivalent(
    stats({ competition: "premier-league", matches: 30, goals_conceded: 33 }), "P",
    expectedConcededPerGame(0.9),
  ).goals_conceded) === 33);

console.log("\n== Piu' competizioni nella stessa stagione ==");
const mixed = normalizeHistory(
  [
    stats({ season: "2025-26", competition: "serie-b", matches: 18, goals: 9, avg_vote: null }),
    stats({ season: "2025-26", competition: "serie-a", matches: 12, goals: 2, avg_vote: 6.1, avg_fantavote: 6.6 }),
    stats({ season: "2024-25", competition: "serie-b", matches: 33, goals: 12 }),
  ],
  A,
);
check("una riga per stagione", mixed.length === 2, mixed.length);
check("le presenze si sommano", mixed[0].matches === 30, mixed[0].matches);
check("la piu' recente e' prima", mixed[0].season === "2025-26");
check("il peso e' una via di mezzo fra le due competizioni",
  mixed[0].weightFactor > 0.75 && mixed[0].weightFactor < 1, mixed[0].weightFactor);
check("resta marcata come parzialmente convertita", mixed[0].converted === true);
check("compaiono entrambe le competizioni", mixed[0].parts.length === 2, mixed[0].parts);

console.log("\n== Competizioni da ignorare o riconoscere ==");
check("le nazionali non contano", shouldSkipCompetition("World Cup Qualification Europe", "World"));
check("nemmeno le amichevoli", shouldSkipCompetition("Friendlies", "World"));
check("nemmeno l'Europeo", shouldSkipCompetition("Euro Championship", "World"));
check("nemmeno le giovanili", shouldSkipCompetition("UEFA U21 Championship", "World"));
check("nemmeno le squadre riserve", shouldSkipCompetition("Premier League 2 Reserve", "England"));
check("la Champions invece si tiene", !shouldSkipCompetition("UEFA Champions League", "World"));
check("e cosi' l'Europa League", !shouldSkipCompetition("UEFA Europa League", "World"));
check("i campionati nazionali si tengono", !shouldSkipCompetition("Bundesliga", "Germany"));
check("una coppa nazionale viene riconosciuta come tale",
  resolveCompetition("DFB Pokal", "Germany").key === "coppa-nazionale",
  resolveCompetition("DFB Pokal", "Germany").key);
check("e la Coppa Italia pure",
  resolveCompetition("Coppa Italia", "Italy").key === "coppa-nazionale",
  resolveCompetition("Coppa Italia", "Italy").key);
check("in coppa i gol valgono meno che in campionato",
  resolveCompetition("DFB Pokal", "Germany").production <
    competitionByKey("bundesliga").production);

console.log("\n== Righe dalle fonti esterne ==");
const dupes = [
  { player_id: "x", season: "2025-26", competition: "serie-b", matches: 18, goals: 7, rating: 7.0, minutes: 1500 },
  { player_id: "x", season: "2025-26", competition: "serie-b", matches: 12, goals: 3, rating: 6.6, minutes: 900 },
  { player_id: "x", season: "2025-26", competition: "serie-a", matches: 5, goals: 1, rating: 6.2, minutes: 300 },
];
const fused = mergeDuplicates(dupes);
check("due meta' di stagione nello stesso campionato diventano una riga", fused.length === 2, fused.length);
const fusedB = fused.find((r) => r.competition === "serie-b")!;
check("le presenze si sommano invece di perderne una", fusedB.matches === 30, fusedB.matches);
check("e cosi' i gol", fusedB.goals === 10, fusedB.goals);
check("il rating e' una media pesata sulle presenze, non una somma",
  Math.abs(Number(fusedB.rating) - (7.0 * 18 + 6.6 * 12) / 30) < 0.001, fusedB.rating);
check("competizioni diverse restano separate",
  fused.some((r) => r.competition === "serie-a"));

const { keep, skipped } = dropWhereBetterExists(fused, [
  { player_id: "x", season: "2025-26", competition: "serie-a", source: "import" },
]);
check("il dato ufficiale non viene sovrascritto da una ricostruzione",
  keep.length === 1 && keep[0].competition === "serie-b", keep);
check("e lo scarto viene contato", skipped === 1, skipped);

console.log("\n== La precedenza fra fonti vale fra un lotto e l'altro ==");
const riga = (source: string, competition = "serie-a"): StatRow =>
  ({ player_id: "x", season: "2025-26", competition, source }) as unknown as StatRow;
const gia = (source: string, competition = "serie-a") =>
  ({ player_id: "x", season: "2025-26", competition, source });

check("il modello non sovrascrive l'archivio",
  dropWhereBetterExists([riga("ai")], [gia("api")]).keep.length === 0);
check("il modello non sovrascrive un inserimento a mano",
  dropWhereBetterExists([riga("ai")], [gia("manual")]).keep.length === 0);
check("l'archivio sovrascrive il modello",
  dropWhereBetterExists([riga("api")], [gia("ai")]).keep.length === 1);
check("una corsa nuova aggiorna una vecchia della stessa fonte",
  dropWhereBetterExists([riga("api")], [gia("api")]).keep.length === 1);
check("niente in archivio, si scrive",
  dropWhereBetterExists([riga("ai")], []).keep.length === 1);
check("la protezione e' per stagione e competizione, non per giocatore",
  dropWhereBetterExists([riga("ai", "serie-b")], [gia("import")]).keep.length === 1);
check("e dice cosa ha protetto",
  dropWhereBetterExists([riga("ai")], [gia("api")]).protette[0]?.includes("archivio sportivo") === true,
  dropWhereBetterExists([riga("ai")], [gia("api")]).protette);

console.log("\n== Il nome per esteso batte l'abbreviazione, un'altra persona no ==");
check("J. Stones -> John Stones e' un'espansione", isExpansionOf("John Stones", "J. Stones"));
check("K. Koulierakis -> Konstantinos Koulierakis lo e'",
  isExpansionOf("Konstantinos Koulierakis", "K. Koulierakis"));
check("Sergiusz Woltemade non espande Nick Woltemade",
  !isExpansionOf("Sergiusz Woltemade", "Nick Woltemade"));
check("un cognome diverso non e' un'espansione",
  !isExpansionOf("John Stone", "J. Stones"));
check("togliere parole non e' espandere",
  !isExpansionOf("Stones", "J. Stones"));

console.log("\n== Quante stagioni entrano nel calcolo ==");
const cinque = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22"].map((season) =>
  stats({ season, matches: 30, avg_vote: 6.1, avg_fantavote: 6.5, goals: 5 }),
);
const norm5 = normalizeHistory(cinque, A);
check("cinque stagioni concluse vengono tutte considerate", SEASON_WEIGHTS.length === 5, SEASON_WEIGHTS);
check("i pesi calano sempre", SEASON_WEIGHTS.every((w, i) => i === 0 || w < SEASON_WEIGHTS[i - 1]));
check("la piu' vecchia pesa meno di un decimo della piu' recente",
  SEASON_WEIGHTS[4] / SEASON_WEIGHTS[0] < 0.1, SEASON_WEIGHTS[4]);
check("normalizeHistory le restituisce ordinate dalla piu' recente",
  norm5[0].season === "2025-26" && norm5[4].season === "2021-22");

console.log("\n== Effetto sul prezzo d'asta ==");
function player(id: string, history: PlayerStatsRow[]): PlayerWithStats {
  return {
    id, season: "2026-27", external_id: null, name: id, team: "Test", role: "A",
    quotation_initial: 20, quotation_current: 20, fvm: 160, is_active: true,
    stats: history[0] ?? null, history,
  };
}
// Riempitivo per dare al motore una popolazione minima su cui calibrare.
const filler: PlayerWithStats[] = [];
for (let i = 0; i < 120; i++) {
  const role: Role = i < 24 ? "P" : i < 60 ? "D" : i < 96 ? "C" : "A";
  filler.push({
    id: `f${i}`, season: "2026-27", external_id: null, name: `Filler ${i}`, team: `T${i % 20}`,
    role, quotation_initial: 5, quotation_current: 5, fvm: 40, is_active: true,
    stats: null,
    history: [stats({ player_id: `f${i}`, matches: 28, avg_vote: 6.0, avg_fantavote: 6.1, goals: 2 })],
  });
}
const bomberSerieA = player("SerieA20", [stats({ goals: 20, avg_vote: 6.4, avg_fantavote: 8.2 })]);
const bomberOlanda = player("Olanda20", [stats({ competition: "eredivisie", goals: 20, rating: 7.4 })]);
const bomberSerieB = player("SerieB20", [stats({ competition: "serie-b", goals: 20, rating: 7.4 })]);
const senzaDati = player("SenzaDati", []);

const vals = buildValuations(
  [...filler, bomberSerieA, bomberOlanda, bomberSerieB, senzaDati],
  { season: "2026-27", nParticipants: 8, budget: 500, slots: DEFAULT_SLOTS, rules: DEFAULT_RULES },
);
const price = (id: string) => Math.round(vals.byPlayer.get(id)!.baseValue);
// Su una popolazione di prova cosi' piccola i valori assoluti non significano
// niente: conta l'ordine fra i quattro casi.
const top = price("SerieA20");
console.log(
  `  A parita' di 20 gol, in proporzione: Serie A 100 · Eredivisie ` +
    `${Math.round((price("Olanda20") / top) * 100)} · Serie B ${Math.round((price("SerieB20") / top) * 100)} · ` +
    `senza dati ${Math.round((price("SenzaDati") / top) * 100)}`,
);
check("20 gol in Serie A valgono piu' di 20 in Eredivisie",
  price("SerieA20") > price("Olanda20"), [price("SerieA20"), price("Olanda20")]);
check("20 in Eredivisie valgono piu' di 20 in Serie B",
  price("Olanda20") > price("SerieB20"), [price("Olanda20"), price("SerieB20")]);
check("ma chi arriva dall'estero vale piu' di chi non ha dati",
  price("Olanda20") > price("SenzaDati"), [price("Olanda20"), price("SenzaDati")]);
check("il bomber di Serie B non viene azzerato",
  price("SerieB20") > 1, price("SerieB20"));
check("le competizioni convertite vengono dichiarate",
  vals.byPlayer.get("Olanda20")!.convertedFrom.some((c) => c.key === "eredivisie"),
  vals.byPlayer.get("Olanda20")!.convertedFrom);

console.log("\n== Una riga che si contraddice da sola e' inventata ==");
const base = {
  competition: "serie-a", matches: 30, minutes: 2400, goals: 10, assists: 5,
  yellow_cards: 4, red_cards: 0, pen_scored: 2, clean_sheets: 0, goals_conceded: 0,
  avg_vote: 6.4, avg_fantavote: 7.5, rating: 7.1,
};
check("una riga normale passa", coerente(base, "A"), incoerenze(base, "A"));
check("315 presenze in Serie A no",
  incoerenze({ ...base, matches: 315 }, "A").length > 0);
check("ma 42 presenze in Serie B si",
  coerente({ ...base, competition: "serie-b", matches: 42, minutes: 3400 }, "A"));
check("piu rigori segnati che gol no",
  incoerenze({ ...base, goals: 1, pen_scored: 3 }, "A").length > 0);
check("gol subiti a un difensore no",
  incoerenze({ ...base, goals_conceded: 2 }, "D").length > 0);
check("gol subiti a un portiere si", coerente({ ...base, goals_conceded: 35 }, "P"));
check("clean sheet piu delle presenze no",
  incoerenze({ ...base, clean_sheets: 40 }, "P").length > 0);
check("meno minuti che presenze no",
  incoerenze({ ...base, minutes: 12 }, "A").length > 0);
check("piu di centotrenta minuti a presenza no",
  incoerenze({ ...base, minutes: 4200 }, "A").length > 0);
check("ma due partite ai supplementari si",
  coerente({ ...base, matches: 2, minutes: 210, goals: 0, assists: 0,
             yellow_cards: 1, pen_scored: 0 }, "D"),
  incoerenze({ ...base, matches: 2, minutes: 210, goals: 0, assists: 0,
               yellow_cards: 1, pen_scored: 0 }, "D"));
// Il caso vero: Koulierakis, tre partite di coppa da cento minuti l'una.
check("ma i supplementari di coppa si",
  coerente(
    { ...base, competition: "coppa-nazionale", matches: 3, minutes: 300, goals: 0,
      assists: 0, yellow_cards: 1, pen_scored: 0 },
    "D",
  ),
  incoerenze(
    { ...base, competition: "coppa-nazionale", matches: 3, minutes: 300, goals: 0,
      assists: 0, yellow_cards: 1, pen_scored: 0 },
    "D",
  ));
check("sedici minuti da subentrato si",
  coerente({ ...base, matches: 1, minutes: 16, goals: 0, assists: 0, yellow_cards: 0, pen_scored: 0 }, "C"));
check("un difensore con dodici gol resta: raro non e impossibile",
  coerente({ ...base, goals: 12 }, "D"));
check("piu partite da titolare che presenze, della stessa fonte, no",
  incoerenze({ ...base, lineups: 33, lineups_matches: 30 }, "A").length > 0);
check("ma trentadue da titolare su trentadue si",
  coerente({ ...base, lineups: 30, lineups_matches: 30 }, "A"));
check("e la titolarita da sola non si giudica su matches",
  coerente({ ...base, matches: 31, lineups: 32, lineups_matches: 32 }, "A"),
  incoerenze({ ...base, matches: 31, lineups: 32, lineups_matches: 32 }, "A"));
console.log("\n== Minuti che non parlano dello stesso giocatore ==");
// Il caso vero: l'archivio dava a Rafa Marin 38 presenze e 142 minuti.
check("38 presenze in 142 minuti no",
  incoerenze({ ...base, matches: 38, minutes: 142, goals: 0, assists: 0,
               yellow_cards: 2, pen_scored: 0 }, "D").length > 0);
check("19 partite da titolare in 142 minuti no",
  incoerenze({ ...base, matches: 38, minutes: 142, lineups: 19, lineups_matches: 38,
               goals: 0, assists: 0, yellow_cards: 2, pen_scored: 0 }, "D").length > 0);
check("ma due ingressi al novantesimo si",
  coerente({ ...base, matches: 2, minutes: 9, goals: 0, assists: 0,
             yellow_cards: 0, pen_scored: 0 }, "D"),
  incoerenze({ ...base, matches: 2, minutes: 9, goals: 0, assists: 0,
               yellow_cards: 0, pen_scored: 0 }, "D"));
check("e un titolare uscito al quarto d ora una volta sola si",
  coerente({ ...base, matches: 1, minutes: 15, lineups: 1, lineups_matches: 1,
             goals: 0, assists: 0, yellow_cards: 0, pen_scored: 0 }, "D"));
check("trenta partite da titolare in 2600 minuti si",
  coerente({ ...base, matches: 32, minutes: 2600, lineups: 30, lineups_matches: 32,
             goals: 3, assists: 1, yellow_cards: 5, pen_scored: 0 }, "D"));

check("fantamedia fuori scala no",
  incoerenze({ ...base, avg_fantavote: 88 }, "A").length > 0);
check("e la separazione riporta il motivo", (() => {
  const { buone, scartate } = separaIncoerenti(
    [base, { ...base, matches: 315 }],
    () => "A" as const,
  );
  return buone.length === 1 && scartate.length === 1 && scartate[0].problemi[0].includes("315");
})());

console.log(failures === 0 ? "\nTUTTI I CONTROLLI SUPERATI\n" : `\n${failures} CONTROLLI FALLITI\n`);
process.exit(failures === 0 ? 0 : 1);
