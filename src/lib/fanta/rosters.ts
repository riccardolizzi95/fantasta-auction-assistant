/**
 * Abbinare il listone alle rose ufficiali dell'archivio sportivo.
 *
 * Fino a oggi l'identita' si chiedeva al modello, un gruppo di sei per volta, e
 * il banco ha misurato quanto vale: su dieci giocatori difficili, nove
 * ricevevano nomi diversi da configurazioni diverse, tutte con "fiducia alta".
 * Il cognome lo azzeccavano — ma il cognome ce lo dava gia' il listone — e il
 * nome se lo inventavano.
 *
 * Le rose ufficiali risolvono il problema alla radice. Il listone dice
 * "Ramos G." e dice il **Milan**, e la squadra e' certa: dentro una rosa di
 * venticinque nomi, un cognome piu' l'iniziale identifica una persona sola.
 * Non e' una stima con una fiducia dichiarata: e' un abbinamento verificabile.
 *
 * Venti chiamate per tutto il listone, contro le circa centocinquanta che
 * costava chiederlo al modello.
 */

/**
 * Lettere che la scomposizione Unicode non tocca.
 *
 * `NFD` separa la lettera dall'accento — "à" diventa "a" piu' un segno che si
 * puo' togliere — ma solo per i segni combinanti. La "ı" turca senza punto, la
 * "ø" danese, la "ł" polacca e la "đ" croata sono **lettere a se'**, non lettere
 * accentate: NFD le lascia intatte e il filtro successivo le cancellava.
 *
 * Il conto era salato: il listone scrive "Yildiz", "Bobcek", "Ostigard", e
 * Wikidata scrive "Yıldız", "Bobček", "Østigård". Senza questa tabella
 * diventavano "yldz", "bobcek", "stigard" da una parte e altro dall'altra, e
 * l'abbinamento falliva su gente che c'era.
 */
const LETTERE_SPECIALI: Record<string, string> = {
  ı: "i", ø: "o", ł: "l", đ: "d", ð: "d", ß: "ss", æ: "ae", œ: "oe",
  þ: "th", ħ: "h", ŧ: "t", ŀ: "l", ĸ: "k", ʼ: "'", "’": "'",
};

export const senzaAccenti = (v: string) =>
  v
    .toLowerCase()
    .replace(/./g, (c) => LETTERE_SPECIALI[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Le particelle non identificano nessuno, ma spostano quale parola e' il cognome. */
const PARTICELLE = new Set([
  "de", "del", "della", "di", "da", "dal", "van", "von", "der", "den", "le", "la",
  "el", "al", "bin", "ben", "dos", "das", "do", "mc", "mac", "st",
]);

/**
 * Il cognome ridotto a quello che identifica davvero.
 *
 * L'apostrofo se ne va: il listone scrive "N'Dicka" e "N'Dri", l'archivio
 * scrive "Ndicka", e su quell'apostrofo si perdeva l'abbinamento di un titolare
 * della Roma. Non distingue due persone, e le due fonti non sono d'accordo su
 * dove metterlo.
 */
const chiaveCognome = (v: string) =>
  v.replace(/['\u2019]/g, "").replace(/[^a-z -]/g, "").replace(/\s+/g, " ").trim();

export type NomeScomposto = {
  /** Il cognome, in minuscolo e senza accenti. Con le particelle attaccate. */
  cognome: string;
  /** L'iniziale del nome, se il formato la porta. */
  iniziale: string | null;
  /** Il nome per esteso, se c'e'. */
  nome: string | null;
};

/**
 * Scompone un nome dal listone di Fantacalcio.it.
 *
 * Il formato e' "Cognome I." — "Ramos G.", "Martinez L." — ma non sempre:
 * i cognomi unici stanno da soli ("Vicario", "Koulierakis") e alcuni portano
 * due parole ("Caleta-Car", "Sanchez Ro." dove "Ro." abbrevia il secondo
 * cognome, non il nome).
 */
export function scomponiListone(nome: string): NomeScomposto {
  const parti = senzaAccenti(nome).split(/\s+/).filter(Boolean);
  if (parti.length === 0) return { cognome: "", iniziale: null, nome: null };

  const ultima = parti[parti.length - 1];
  // Un'ultima parola breve e puntata e' un'abbreviazione, non il cognome.
  const abbreviata = ultima.endsWith(".") && ultima.replace(/\./g, "").length <= 2;
  const pezziCognome = abbreviata ? parti.slice(0, -1) : parti;
  return {
    cognome: chiaveCognome(pezziCognome.join(" ")),
    iniziale: abbreviata ? ultima.replace(/\./g, "")[0] ?? null : null,
    nome: null,
  };
}

/**
 * Scompone un nome come lo restituisce l'archivio.
 *
 * Puo' arrivare in tre forme, e le abbiamo viste tutte e tre: "John Stones" per
 * esteso, "J. Stones" abbreviato, oppure nome e cognome in campi separati.
 * Quando ci sono i campi separati vincono loro: sono l'unica forma che non
 * costringe a indovinare dove finisce il nome e comincia il cognome.
 */
export function scomponiArchivio(entry: {
  name?: string | null;
  firstname?: string | null;
  lastname?: string | null;
}): NomeScomposto {
  if (entry.firstname && entry.lastname) {
    const nome = senzaAccenti(entry.firstname).trim();
    return {
      cognome: chiaveCognome(senzaAccenti(entry.lastname)),
      iniziale: nome[0] ?? null,
      nome: entry.firstname.trim(),
    };
  }
  const grezzo = (entry.name ?? "").trim();
  const parti = senzaAccenti(grezzo).split(/\s+/).filter(Boolean);
  if (parti.length <= 1) {
    return { cognome: chiaveCognome(parti[0] ?? ""), iniziale: null, nome: null };
  }
  // Il cognome e' l'ultima parola, piu' le particelle che la precedono.
  let da = parti.length - 1;
  while (da > 0 && PARTICELLE.has(parti[da - 1])) da -= 1;
  const cognome = chiaveCognome(parti.slice(da).join(" "));
  const testa = parti.slice(0, da);
  const primaParola = testa[0] ?? "";
  const eIniziale = primaParola.replace(/\./g, "").length <= 2;
  return {
    cognome,
    iniziale: primaParola.replace(/\./g, "")[0] ?? null,
    // Se la testa e' un'iniziale non abbiamo il nome: dirlo, invece di
    // spacciare "J." per un nome proprio.
    nome: eIniziale ? null : grezzo.split(/\s+/).slice(0, testa.length).join(" "),
  };
}

/**
 * Una voce di rosa, da qualunque fonte.
 *
 * L'id e' una stringa e non un numero perche' le fonti non lo scrivono nello
 * stesso modo: l'archivio sportivo usa interi, Wikidata usa "Q615256". Legare
 * questa struttura al formato di una sola fonte avrebbe voluto dire riscriverla
 * alla seconda.
 */
export type VoceRosa = {
  id: string;
  name?: string | null;
  firstname?: string | null;
  lastname?: string | null;
};

export type GiocatoreListone = { id: string; name: string; team: string };

export type Abbinamento = {
  playerId: string;
  listone: string;
  id: string;
  /** Il nome per esteso, quando l'archivio lo porta. */
  fullName: string | null;
  /** Come si e' arrivati all'abbinamento: serve a saperne la solidita'. */
  come: "cognome-unico" | "cognome-e-iniziale";
};

export type EsitoAbbinamento = {
  trovati: Abbinamento[];
  /** Piu' di un candidato con lo stesso cognome e la stessa iniziale. */
  ambigui: { playerId: string; listone: string; candidati: string[] }[];
  /** Nessun candidato nella rosa. */
  mancanti: { playerId: string; listone: string }[];
};

/**
 * Abbina i giocatori di una squadra del listone alla sua rosa ufficiale.
 *
 * Prima per cognome: se in venticinque nomi quel cognome compare una volta
 * sola, e' lui, e l'iniziale non serve nemmeno. Se compare piu' volte decide
 * l'iniziale del nome, che e' esattamente l'informazione che il listone
 * aggiunge quando abbrevia. Se restano due candidati non si sceglie: un
 * abbinamento sbagliato manda a cercare le statistiche di un'altra persona, e
 * fra un dato sbagliato e nessun dato, nessun dato fa molti meno danni.
 */
export function abbinaRosa(
  listone: GiocatoreListone[],
  rosa: VoceRosa[],
): EsitoAbbinamento {
  const perCognome = new Map<string, { voce: VoceRosa; nome: NomeScomposto }[]>();
  for (const voce of rosa) {
    const nome = scomponiArchivio(voce);
    if (!nome.cognome) continue;
    perCognome.set(nome.cognome, [...(perCognome.get(nome.cognome) ?? []), { voce, nome }]);
  }

  const trovati: Abbinamento[] = [];
  const ambigui: EsitoAbbinamento["ambigui"] = [];
  const mancanti: EsitoAbbinamento["mancanti"] = [];

  for (const p of listone) {
    const cercato = scomponiListone(p.name);
    let candidati = perCognome.get(cercato.cognome) ?? [];

    // Un cognome composto puo' essere scritto con o senza trattino, e il
    // listone a volte ne porta solo l'ultimo pezzo.
    if (candidati.length === 0) {
      const senzaTrattini = cercato.cognome.replace(/-/g, " ");
      for (const [k, v] of perCognome) {
        if (k.replace(/-/g, " ") === senzaTrattini) candidati = v;
      }
    }

    if (candidati.length === 0) {
      mancanti.push({ playerId: p.id, listone: p.name });
      continue;
    }
    if (candidati.length === 1) {
      const { voce, nome } = candidati[0];
      trovati.push({
        playerId: p.id,
        listone: p.name,
        id: voce.id,
        fullName: nomeCompleto(nome, voce),
        come: "cognome-unico",
      });
      continue;
    }

    const conIniziale = cercato.iniziale
      ? candidati.filter((c) => c.nome.iniziale === cercato.iniziale)
      : [];
    if (conIniziale.length === 1) {
      const { voce, nome } = conIniziale[0];
      trovati.push({
        playerId: p.id,
        listone: p.name,
        id: voce.id,
        fullName: nomeCompleto(nome, voce),
        come: "cognome-e-iniziale",
      });
      continue;
    }
    ambigui.push({
      playerId: p.id,
      listone: p.name,
      candidati: (conIniziale.length > 0 ? conIniziale : candidati).map(
        (c) => c.voce.name ?? `${c.voce.firstname ?? ""} ${c.voce.lastname ?? ""}`.trim(),
      ),
    });
  }

  return { trovati, ambigui, mancanti };
}

/** Il nome per esteso solo se l'archivio lo porta davvero. */
function nomeCompleto(nome: NomeScomposto, voce: VoceRosa): string | null {
  if (voce.firstname && voce.lastname) return `${voce.firstname} ${voce.lastname}`.trim();
  return nome.nome ? (voce.name ?? null) : null;
}

/**
 * Il nome di una squadra senza il contorno societario.
 *
 * "AS Roma", "AC Milan", "SSC Napoli", "Bologna FC 1909" diventano "roma",
 * "milan", "napoli", "bologna": e' la parte che identifica davvero il club.
 */
const nudo = (v: string) =>
  senzaAccenti(v)
    .replace(/\b(fc|ac|as|ssc|us|uc|acf|cfc|ss|calcio|football|club|societa|sportiva)\b/g, "")
    .replace(/\b(18|19|20)\d{2}\b/g, "")
    .replace(/[^a-z]/g, "");

/** Confronta due nomi di squadra: "Inter" e "Internazionale" sono la stessa. */
export function stessaSquadra(a: string, b: string): boolean {
  return punteggioSquadra(a, b) > 0;
}

/**
 * Quanto due nomi di squadra si somigliano: 3 uguali, 0 estranei.
 *
 * Un booleano non bastava. Cercando "Roma" nell'archivio tornano "AS Roma",
 * "Roma W" e "Romana", e tutte e tre **contengono** "roma": con un si'/no si
 * finiva a sceglierne una per lunghezza del nome, ed e' cosi' che ventitre
 * giocatori della Roma sono stati cercati prima nella squadra femminile e poi
 * in un club minore. L'uguaglianza esatta, una volta tolto il contorno
 * societario, le separa: "AS Roma" vale 3, "Romana" vale 2.
 */
export function punteggioSquadra(listone: string, archivio: string): number {
  const x = nudo(listone);
  const y = nudo(archivio);
  if (!x || !y) return 0;
  if (x === y) return 3;
  // "Hellas Verona" per "Verona": il nome del listone e' un pezzo intero,
  // all'inizio o alla fine, non una scheggia in mezzo.
  if (y.startsWith(x) || y.endsWith(x) || x.startsWith(y) || x.endsWith(y)) return 2;
  return y.includes(x) || x.includes(y) ? 1 : 0;
}

/**
 * Se un nome proposto sta rubando l'identita' di un altro giocatore del listone.
 *
 * Il modello ha attribuito a "Pompei" dell'Atalanta il nome "Marco
 * Carnesecchi", scrivendo nella nota di non aver trovato Pompei da nessuna
 * parte e di aver scelto "l'unico portiere dell'Atalanta con un nome che
 * potrebbe essere abbreviato in modo simile" — cioe' il titolare del ruolo, che
 * nel listone c'e' gia' con il suo nome.
 *
 * E' quello il danno da fermare: non un nome inventato qualunque, ma un nome
 * che appartiene a **un'altra riga della stessa rosa**, perche' da li' in poi le
 * ricerche di statistiche pescano la persona sbagliata.
 *
 * Chi chiama passa **gli altri** della rosa, non lui stesso: altrimenti ogni
 * identificazione corretta collide con se stessa.
 *
 * Il primo tentativo era piu' severo — pretendere che il cognome del listone
 * comparisse nel nome proposto — e i controlli hanno mostrato subito che
 * rifiutava i soprannomi veri: "Beto" sta per Norberto **Betuncal**, e "beto"
 * dentro "norberto" non c'e' (c'e' "berto"). In Serie A quei casi sono normali,
 * e una regola che li scarta fa piu' danni di quelli che evita.
 */
export function rubaIdentita(
  nomeProposto: string,
  compagniDiSquadra: { name: string }[],
): string | null {
  const proposto = scomponiArchivio({ name: nomeProposto }).cognome;
  if (!proposto || proposto.length < 3) return null;
  const collisione = compagniDiSquadra.find(
    (c) => scomponiListone(c.name).cognome === proposto,
  );
  return collisione ? collisione.name : null;
}
