/**
 * Capire il banditore: come se la cava il riconoscimento locale.
 *
 * Le frasi sono quelle che si sentono davvero a un'asta, comprese le storpiature
 * che un motore vocale produce sui nomi stranieri. Serve a sapere **quanto**
 * copre la parte gratuita, perche' e' quella che decide quante volte bisogna
 * disturbare il modello.
 */
import {
  agganciaRuolo,
  agganciaSquadra,
  interpreta,
  interpretaAlternative,
  somiglianza,
} from "../src/lib/fanta/astaVocale";
import { numeroItaliano, estraiNumeri } from "../src/lib/fanta/numeriItaliani";

let bad = 0;
const check = (l: string, ok: boolean, d?: unknown) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${l}`, ok ? "" : (d ?? ""));
  if (!ok) bad++;
};

// I ruoli ci sono perche' sono meta' del lavoro: nel listone vero i due
// Martinez sono entrambi dell'Inter e a separarli e' solo il ruolo.
const listone = [
  { id: "1", name: "Martinez L.", team: "Inter", role: "A", fullName: "Lautaro Martínez" },
  { id: "2", name: "Martinez Jo.", team: "Inter", role: "P", fullName: "Josep Martínez" },
  { id: "3", name: "Calhanoglu", team: "Inter", role: "C" },
  { id: "4", name: "De Bruyne", team: "Napoli", role: "C", fullName: "Kevin De Bruyne" },
  { id: "5", name: "Caleta-Car", team: "Sassuolo", role: "D" },
  { id: "6", name: "Zambo Anguissa", team: "Napoli", role: "C" },
  { id: "7", name: "Ramos G.", team: "Milan", role: "A" },
  { id: "8", name: "Dimarco", team: "Inter", role: "D" },
  { id: "9", name: "Yildiz", team: "Juventus", role: "A" },
  { id: "10", name: "Thuram", team: "Inter", role: "A" },
  { id: "11", name: "Thuram K.", team: "Juventus", role: "C" },
  { id: "12", name: "Terracciano", team: "Milan", role: "P" },
  { id: "13", name: "Terracciano F.", team: "Milan", role: "D" },
];
const squadre = [
  { id: "a", name: "Giorgio" },
  { id: "b", name: "Marco" },
  { id: "c", name: "Giulia" },
];

console.log("== Frasi da banditore ==");
const casi: { frase: string; giocatore?: string; prezzo?: number; chi?: string; sicuro: boolean }[] = [
  { frase: "Lautaro Martinez duecentoquaranta a Giorgio", giocatore: "1", prezzo: 240, chi: "a", sicuro: true },
  { frase: "Dimarco 95 Marco", giocatore: "8", prezzo: 95, chi: "b", sicuro: true },
  { frase: "aggiudicato De Bruyne per centottanta a Giulia", giocatore: "4", prezzo: 180, chi: "c", sicuro: true },
  { frase: "Yildiz va a Giorgio per settanta", giocatore: "9", prezzo: 70, chi: "a", sicuro: true },
  { frase: "Zambo Anguissa quarantacinque Marco", giocatore: "6", prezzo: 45, chi: "b", sicuro: true },
  // Storpiature che i motori vocali producono davvero sui nomi stranieri.
  { frase: "Cialanoglu ottanta a Marco", giocatore: "3", prezzo: 80, chi: "b", sicuro: true },
  { frase: "Caleta Car venticinque Giulia", giocatore: "5", prezzo: 25, chi: "c", sicuro: true },
];

for (const c of casi) {
  const r = interpreta(c.frase, listone, squadre);
  const ok =
    (!c.giocatore || r.playerId === c.giocatore) &&
    (!c.prezzo || r.prezzo === c.prezzo) &&
    (!c.chi || r.partecipanteId === c.chi);
  check(`"${c.frase}"`, ok, `${r.nomeGiocatore} / ${r.prezzo} / ${r.nomePartecipante} — ${r.perche}`);
  if (c.sicuro) {
    check(`   ...e con abbastanza confidenza (${r.confidenza.toFixed(2)})`, r.confidenza >= 0.75, r.perche);
  }
}

console.log("\n== Quando NON deve decidere da solo ==");
const ambigua = interpreta("Martinez centoventi a Giorgio", listone, squadre);
check("due Martinez nella stessa squadra: non sceglie",
  ambigua.playerId === null && ambigua.altriGiocatori.length >= 2,
  `${ambigua.playerId} — ${ambigua.perche}`);
check("ma il prezzo e l acquirente li ha comunque",
  ambigua.prezzo === 120 && ambigua.partecipanteId === "a");
check("e la confidenza e' bassa, cosi' interviene il modello",
  ambigua.confidenza < 0.75, ambigua.confidenza);

const thuram = interpreta("Thuram cinquanta a Marco", listone, squadre);
check("due Thuram in squadre diverse: non sceglie",
  thuram.playerId === null, `${thuram.nomeGiocatore} — ${thuram.perche}`);

const nulla = interpreta("allora ragazzi chi vuole rilanciare", listone, squadre);
check("una frase senza chiamata non inventa niente",
  nulla.playerId === null && nulla.prezzo === null && nulla.confidenza === 0,
  nulla.perche);

console.log("\n== La somiglianza fa quello che deve ==");
check("Cialanoglu ~ Calhanoglu", somiglianza("cialanoglu", "calhanoglu") > 0.75,
  somiglianza("cialanoglu", "calhanoglu").toFixed(2));
check("Lautaro non somiglia a Dimarco", somiglianza("lautaro", "dimarco") < 0.5);
check("numeri e nomi restano separati", numeroItaliano("thuram") === null &&
  estraiNumeri("Thuram cinquanta").length === 1);

console.log("\n== L'anagrafica scioglie gli omonimi ==");
//
// Sono i casi che il suono da solo non puo' risolvere, ed e' per questo che
// esistono: nel listone 2026/27 ci sono tredici gruppi di cognomi uguali, e
// squadra e ruolo insieme li sciolgono tutti.
const conSquadra: { frase: string; atteso: string }[] = [
  { frase: "Thuram della Juve cinquanta a Marco", atteso: "11" },
  { frase: "Thuram dell'Inter novanta a Marco", atteso: "10" },
  { frase: "Thuram bianconeri cinquanta", atteso: "11" },
];
for (const c of conSquadra) {
  const r = interpreta(c.frase, listone, squadre);
  check(`"${c.frase}" -> ${c.atteso}`, r.playerId === c.atteso, `${r.nomeGiocatore} — ${r.perche}`);
}

const conRuolo: { frase: string; atteso: string }[] = [
  { frase: "il portiere Martinez venti a Giulia", atteso: "2" },
  { frase: "l'attaccante Martinez duecento a Giorgio", atteso: "1" },
  { frase: "Terracciano portiere otto", atteso: "12" },
  { frase: "il difensore Terracciano cinque", atteso: "13" },
];
for (const c of conRuolo) {
  const r = interpreta(c.frase, listone, squadre);
  check(`"${c.frase}" -> ${c.atteso}`, r.playerId === c.atteso, `${r.nomeGiocatore} — ${r.perche}`);
}

console.log("\n== Chi e' gia' stato venduto non viene richiamato ==");
const venduto = interpreta("Dimarco novantacinque Marco", listone, squadre, {
  gia: new Set(["8"]),
});
check("non lo sceglie da solo", venduto.playerId === null, venduto.perche);
check("ma resta fra i candidati, che una registrazione si puo' correggere",
  venduto.altriGiocatori.some((c) => c.id === "8"));

console.log("\n== E non inventa squadre dove non ce ne sono ==");
const tutte = ["Como", "Inter", "Juventus", "Milan"];
check("«come» non e' il Como", agganciaSquadra("allora come siamo messi", tutte) === null);
check("«l'Inter» si', anche con l'apostrofo", agganciaSquadra("Thuram dell'Inter", tutte) === "Inter");
check("«juve» vale Juventus", agganciaSquadra("il difensore della juve", tutte) === "Juventus");
check("un soprannome di una squadra che non c'e' non vale",
  agganciaSquadra("i giallorossi rilanciano", tutte) === null);
check("il ruolo si riconosce", agganciaRuolo("adesso il portiere") === "P" &&
  agganciaRuolo("un centrocampista") === "C" && agganciaRuolo("chi rilancia") === null);

console.log("\n== Fra piu' trascrizioni sceglie quella che regge ==");
//
// Il riconoscitore ordina le alternative per quanto suonano come italiano, non
// per quanto somigliano a un cognome: la prima e' spesso la peggiore.
const alt = interpretaAlternative(
  ["cala nogli ottanta a marco", "calanoli ottanta a marco", "calhanoglu ottanta a marco"],
  listone,
  squadre,
);
check("sceglie la trascrizione che aggancia il listone", alt?.chiamata.playerId === "3",
  `${alt?.frase} -> ${alt?.chiamata.nomeGiocatore}`);
const altSenzaNiente = interpretaAlternative(["allora ragazzi", "allora ragazze"], listone, squadre);
check("se nessuna aggancia niente, non inventa",
  altSenzaNiente?.chiamata.playerId == null && altSenzaNiente?.chiamata.prezzo == null);

console.log(bad === 0 ? "\nTUTTI I CONTROLLI SUPERATI\n" : `\n${bad} CONTROLLI FALLITI\n`);
process.exit(bad === 0 ? 0 : 1);
