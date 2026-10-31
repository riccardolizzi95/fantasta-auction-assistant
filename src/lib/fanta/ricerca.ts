/**
 * Trovare un giocatore mentre il banditore lo sta chiamando.
 *
 * Il vincolo non e' la precisione, e' il tempo: hai pochi secondi e stai
 * digitando con una mano. Quindi la ricerca deve accettare tutto quello che
 * potresti avere in testa in quel momento — il cognome del listone, il nome di
 * battesimo che sul listone non c'e', la squadra, o due di queste insieme — e
 * incrociarle invece di sceglierne una.
 *
 * "lautaro" deve trovare `Martinez L.`, che quella parola non la contiene: sta
 * nel nome completo che arriva dall'identificazione. "martinez inter" deve
 * stringere su uno solo dei due Martinez. "inter" da solo deve dare l'Inter
 * ordinata per valore.
 */
import { somiglianza } from "./astaVocale";

export type VoceRicerca = {
  id: string;
  name: string;
  team: string;
  fullName?: string | null;
};

const senzaSegni = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Le parole con cui un giocatore puo' essere chiamato.
 *
 * Il nome del listone e' abbreviato (`Martinez L.`) e il puntino finale non e'
 * una parola: `L.` diventa `l`, che come chiave di ricerca non serve a niente ma
 * non fa danno. Il nome completo, quando c'e', porta il nome di battesimo — che
 * e' quello con cui il banditore chiama meta' dei giocatori.
 */
export type Indice = {
  id: string;
  /** Cognome e nome, dal listone e dall'identificazione. */
  parole: string[];
  /** Le parole della squadra. */
  squadra: string[];
};

export function indicizza(v: VoceRicerca): Indice {
  const dal = (s: string | null | undefined) => (s ? senzaSegni(s).split(" ").filter((w) => w.length > 1) : []);
  const parole = [...new Set([...dal(v.name), ...dal(v.fullName)])];
  return { id: v.id, parole, squadra: dal(v.team) };
}

/** Quanto una parola scritta somiglia a una parola dell'indice. */
function puntoParola(scritta: string, candidata: string): number {
  if (candidata === scritta) return 100;
  if (candidata.startsWith(scritta)) return 90;
  if (candidata.includes(scritta)) return 60;
  // Sotto le quattro lettere la distanza di edit accetta troppo: "aba" somiglia
  // a mezzo listone.
  if (scritta.length < 4) return 0;
  const s = somiglianza(scritta, candidata);
  return s >= 0.75 ? Math.round(45 * s) : 0;
}

const meglio = (scritta: string, parole: string[]) =>
  parole.reduce((max, c) => Math.max(max, puntoParola(scritta, c)), 0);

/**
 * Il punteggio di un giocatore per quello che hai scritto.
 *
 * **Ogni parola scritta deve trovare qualcosa**, altrimenti il giocatore esce.
 * E' questa la regola che fa incrociare le informazioni: "martinez inter"
 * chiede un giocatore che sia insieme un Martinez e dell'Inter, mentre sommando
 * i punteggi senza pretenderlo verrebbero fuori tutti i Martinez del listone e
 * tutta l'Inter, ordinati per caso.
 *
 * La squadra vale meno del nome a parita' di aderenza: chi scrive "roma" quasi
 * sempre cerca la squadra, ma chi scrive "romagnoli" cerca lui.
 */
export function punteggio(indice: Indice, parole: string[]): number {
  let totale = 0;
  for (const parola of parole) {
    const daNome = meglio(parola, indice.parole);
    const grezzoSquadra = meglio(parola, indice.squadra);
    // Lo sconto sulla squadra vale sui parziali, non su un nome di squadra
    // scritto per intero: chi scrive "roma" cerca la Roma, e senza questa
    // eccezione gli usciva prima Romano del Cagliari, il cui cognome comincia
    // per le stesse quattro lettere. Chi scrive "romagnoli" cerca lui, e li' il
    // nome vince da solo perche' la squadra non lo contiene.
    const daSquadra = grezzoSquadra === 100 ? 100 : Math.round(grezzoSquadra * 0.7);
    const p = Math.max(daNome, daSquadra);
    if (p === 0) return 0;
    totale += p;
  }
  // Due parole che centrano valgono piu' del doppio di una: chi scrive due cose
  // sta restringendo apposta.
  return totale * (1 + 0.15 * (parole.length - 1));
}

export function paroleDi(query: string): string[] {
  return senzaSegni(query).split(" ").filter(Boolean);
}
