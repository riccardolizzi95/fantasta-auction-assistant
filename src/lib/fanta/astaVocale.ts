/**
 * Capire una chiamata d'asta detta a voce.
 *
 * Il problema sembra "riconoscere il parlato" e non lo e': il riconoscimento lo
 * fa il browser. Quello che resta e' agganciare quello che ha sentito a **liste
 * che conosciamo gia'** — 533 nomi del listone, gli otto partecipanti, i numeri
 * fino al budget — e la frase ha una forma fissa: chi, quanto, a chi.
 *
 * E' per questo che puo' funzionare in una stanza rumorosa dove la dettatura
 * libera fallirebbe: non bisogna capire una lingua, bisogna scegliere fra
 * cinquecento possibilita' note. "Cialanoglu" non e' una parola italiana ma e'
 * a due errori di distanza da "Calhanoglu" e a venti da chiunque altro.
 *
 * Niente qui decide qualcosa da solo: si propone, e conferma l'utente.
 */
import { senzaAccenti } from "./rosters";
import { estraiNumeri } from "./numeriItaliani";

/** Parole che il banditore dice sempre e non identificano nessuno. */
const RUMORE = new Set([
  "a", "ad", "al", "alla", "allo", "ai", "agli", "e", "ed", "il", "lo", "la", "i",
  "gli", "le", "un", "uno", "una", "di", "da", "per", "con", "su", "in", "va",
  "vai", "aggiudicato", "assegnato", "venduto", "preso", "prende", "prendo",
  "credito", "crediti", "euro", "chi", "chiamo", "chiama", "chiamata", "offro",
  "offre", "rilancio", "base", "prezzo", "ok", "allora", "ecco", "dunque",
]);

const parole = (frase: string) =>
  senzaAccenti(frase)
    .replace(/[^a-z0-9' -]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Quanto due parole si somigliano, 0..1.
 *
 * Distanza di edit normalizzata: e' la misura giusta per gli errori di
 * trascrizione, che sono lettere sbagliate o mancanti, non parole diverse.
 */
export function somiglianza(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) / Math.max(m, n) > 0.5) return 0;
  let prec = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prec[j] + 1,
        cur[j - 1] + 1,
        prec[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prec = cur;
  }
  return 1 - prec[n] / Math.max(m, n);
}

export type VoceListone = {
  id: string;
  name: string;
  team: string;
  /**
   * Il ruolo, che qui non e' un'etichetta ma un discriminante.
   *
   * Nel listone 2026/27 ci sono tredici gruppi di omonimi veri (Martinez,
   * Terracciano, Thuram, Esposito, Pellegrini, Stankovic...) e **squadra e
   * ruolo insieme li sciolgono tutti**: i due Martinez sono entrambi
   * dell'Inter, ma uno e' il portiere; i due Terracciano sono entrambi del
   * Milan, stessa cosa. Il cognome da solo non decide, "il portiere Martinez"
   * si'.
   */
  role?: string;
  /**
   * Il nome per esteso, quando lo conosciamo.
   *
   * E' quello che scioglie gli omonimi, ed e' il motivo per cui il lavoro sulle
   * identita' serve anche qui: il listone ha due "Martinez" nella stessa
   * squadra e il cognome da solo non basta, ma il banditore dice "Lautaro
   * Martinez" e con il nome completo la scelta e' netta.
   */
  fullName?: string | null;
};
export type Partecipante = { id: string; name: string };

export type Candidato<T> = {
  voce: T;
  /** Quanto si somigliano, 0..1: e' il numero da mostrare. */
  punteggio: number;
  sentito: string;
  /**
   * Il numero con cui si ordina, che non e' lo stesso.
   *
   * Una corrispondenza piu' lunga dice molto di piu' di una corta: "martinez"
   * fa cento per cento su due giocatori diversi della stessa squadra e non
   * decide niente, mentre "lautaro martinez" ne indica uno solo. Senza questo
   * peso i due omonimi restavano appaiati e il modello veniva disturbato per
   * una frase che era chiarissima.
   */
  peso: number;
};

/**
 * Il miglior aggancio fra una frase e un elenco di nomi.
 *
 * Si provano anche le coppie e le terne di parole vicine, perche' i cognomi
 * composti arrivano spezzati: "de bruyne", "caleta car", "zambo anguissa".
 */
export function agganciaNome<T extends { name: string }>(
  frase: string,
  elenco: T[],
  minimo = 0.72,
): Candidato<T>[] {
  // Le parole corte restano: da sole non identificano nessuno, ma "de" e "van"
  // fanno parte del cognome. Escluderle prima di comporre le finestre faceva
  // sparire De Bruyne.
  const tok = parole(frase).filter((p) => !RUMORE.has(p));
  if (tok.length === 0) return [];

  const finestre: string[] = [];
  for (let i = 0; i < tok.length; i++) {
    for (let len = 1; len <= 3 && i + len <= tok.length; len++) {
      const f = tok.slice(i, i + len).join(" ");
      if (f.replace(/[^a-z]/g, "").length >= 3) finestre.push(f);
    }
  }

  const ripulisci = (v: string) =>
    senzaAccenti(v)
      .replace(/\b[a-z]{1,2}\.\s*$/, "") // l'iniziale puntata del listone
      .replace(/[^a-z' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const out: Candidato<T>[] = [];
  for (const voce of elenco) {
    // Si prova sia con il nome del listone sia con quello per esteso: il
    // banditore dice "Lautaro Martinez", il listone scrive "Martinez L.".
    const bersagli = [ripulisci(voce.name)];
    const esteso = (voce as { fullName?: string | null }).fullName;
    if (esteso) bersagli.push(ripulisci(esteso));

    let best = 0;
    let peso = 0;
    let sentito = "";
    for (const bersaglio of bersagli) {
      if (bersaglio.length < 3) continue;
      for (const f of finestre) {
        const s = somiglianza(f, bersaglio);
        const lettere = f.replace(/[^a-z]/g, "").length;
        const p = s + Math.min(0.2, lettere / 80);
        if (p > peso) {
          peso = p;
          best = s;
          sentito = f;
        }
      }
    }
    if (best >= minimo) out.push({ voce, punteggio: best, sentito, peso });
  }
  return out.sort((a, b) => b.peso - a.peso);
}

/**
 * Come si chiamano le squadre quando le si dice a voce.
 *
 * Solo le forme che un banditore usa davvero e che non possono voler dire
 * altro: "rossoblu" ne vale tre e quindi non c'e'. Un soprannome vale solo se
 * quella squadra e' davvero nel listone, cosi' una lega di un altro campionato
 * non eredita i nostri.
 */
const SOPRANNOMI: Record<string, string> = {
  juve: "juventus",
  bianconeri: "juventus",
  nerazzurri: "inter",
  rossoneri: "milan",
  giallorossi: "roma",
  biancocelesti: "lazio",
  partenopei: "napoli",
  viola: "fiorentina",
  toro: "torino",
  granata: "torino",
  dea: "atalanta",
  grifone: "genoa",
};

/** Le parole, senza apostrofi ne' punteggiatura: "dell'Inter" sono due. */
const paroleNude = (frase: string) =>
  senzaAccenti(frase)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

/**
 * La squadra nominata nella frase, se c'e'.
 *
 * **Solo corrispondenze esatte**, al contrario dei cognomi. I nomi delle
 * squadre sono parole italiane comuni che il riconoscitore scrive giuste, e la
 * somiglianza approssimata qui farebbe solo danni: "come" dista una lettera da
 * "Como", e il banditore dice "come" venti volte al minuto.
 */
export function agganciaSquadra(frase: string, squadre: string[]): string | null {
  const tok = paroleNude(frase);
  if (tok.length === 0) return null;
  const finestre: string[] = [];
  for (let i = 0; i < tok.length; i++) {
    finestre.push(tok[i]);
    if (i + 1 < tok.length) finestre.push(`${tok[i]} ${tok[i + 1]}`);
  }
  const canonico = new Map<string, string>();
  for (const s of squadre) canonico.set(paroleNude(s).join(" "), s);
  for (const f of finestre) {
    const diretto = canonico.get(f);
    if (diretto) return diretto;
  }
  for (const f of finestre) {
    const alias = SOPRANNOMI[f];
    if (alias && canonico.has(alias)) return canonico.get(alias) as string;
  }
  return null;
}

/** Il ruolo nominato nella frase, se c'e'. */
export function agganciaRuolo(frase: string): string | null {
  const t = " " + paroleNude(frase).join(" ") + " ";
  if (/ portier[ei] /.test(t)) return "P";
  if (/ difensor[ei] | terzin[oi] | central[ei] /.test(t)) return "D";
  if (/ centrocampist[ai] | mediano | trequartista | regista /.test(t)) return "C";
  if (/ attaccant[ei] | punta | bomber | centravanti /.test(t)) return "A";
  return null;
}

/**
 * Quello che di questa asta sappiamo gia', e che restringe il campo.
 *
 * E' l'informazione che il suono non ha: chi e' gia' stato assegnato non verra'
 * chiamato di nuovo, e a meta' asta sono duecento nomi in meno fra cui
 * sbagliare.
 */
export type ContestoChiamata = {
  gia?: ReadonlySet<string>;
};

export type Chiamata = {
  /** Il giocatore, se uno solo si stacca dagli altri. */
  playerId: string | null;
  nomeGiocatore: string | null;
  prezzo: number | null;
  partecipanteId: string | null;
  nomePartecipante: string | null;
  /** 0..1: sotto 0.75 conviene chiedere aiuto al modello. */
  confidenza: number;
  /** Perche' ha deciso cosi', in italiano. */
  perche: string;
  /** La squadra nominata nella frase, se c'e': e' quella che scioglie gli omonimi. */
  squadraDetta?: string | null;
  /** Il ruolo nominato nella frase, se c'e'. */
  ruoloDetto?: string | null;
  /**
   * Gli altri candidati, per il modello o per l'utente.
   *
   * Portano ruolo e nome completo perche' e' quello che serve al modello per
   * scegliere: "Martinez" fra un attaccante dell'Inter e un portiere dell'Inter
   * non e' una domanda a cui si possa rispondere con due cognomi uguali.
   */
  altriGiocatori: {
    id: string;
    name: string;
    team: string;
    role?: string | null;
    fullName?: string | null;
    punteggio: number;
  }[];
};

/**
 * Interpreta una frase del banditore.
 *
 * La confidenza non e' il punteggio del migliore ma **quanto stacca il
 * secondo**: un nome riconosciuto al 90% non serve a niente se ce n'e' un altro
 * all'89%. E' li' che serve il modello, non dove il parlato era chiaro.
 *
 * Ed e' li' che serve tutto il resto dell'anagrafica. Il suono di un cognome
 * non basta quasi mai da solo, ma non arriva mai da solo: arriva dentro una
 * frase che dice anche la squadra o il ruolo, e dentro un'asta in cui meta' dei
 * nomi sono gia' stati venduti. Tre informazioni che non costano niente e che
 * fanno il lavoro che al confronto fra suoni non riesce.
 */
export function interpreta(
  frase: string,
  listone: VoceListone[],
  partecipanti: Partecipante[],
  contesto?: ContestoChiamata,
): Chiamata {
  const grezzi = agganciaNome(frase, listone);
  const compratori = agganciaNome(frase, partecipanti, 0.75);
  const numeri = estraiNumeri(frase);

  const squadra = agganciaSquadra(frase, [...new Set(listone.map((v) => v.team))]);
  const ruolo = agganciaRuolo(frase);
  const gia = contesto?.gia;

  /**
   * Il peso, corretto con quello che sappiamo oltre al suono.
   *
   * I numeri sono tarati perche' **la squadra decide e il ruolo conferma**: fra
   * i due Pellegrini la squadra detta vale piu' di qualunque differenza di
   * pronuncia, mentre il ruolo da solo ne separa due su tre. Chi e' gia' stato
   * venduto scende cosi' tanto da non poter piu' vincere, ma resta nell'elenco:
   * il banditore puo' sempre correggere un'aggiudicazione sbagliata.
   */
  const giocatori = grezzi
    .map((c) => {
      let peso = c.peso;
      const suo = c.voce as VoceListone;
      if (squadra) peso += paroleNude(suo.team).join(" ") === paroleNude(squadra).join(" ") ? 0.35 : -0.2;
      if (ruolo && suo.role) peso += suo.role === ruolo ? 0.15 : -0.12;
      if (gia?.has(suo.id)) peso -= 0.6;
      return { ...c, peso };
    })
    .sort((a, b) => b.peso - a.peso);

  const primo = giocatori[0];
  const secondo = giocatori[1];
  const stacco = primo ? primo.peso - (secondo?.peso ?? 0) : 0;

  const motivi: string[] = [];
  if (!primo) motivi.push("nessun nome del listone riconosciuto");
  else {
    motivi.push(`"${primo.sentito}" somiglia a ${primo.voce.name} (${Math.round(primo.punteggio * 100)}%)`);
    if (squadra) motivi.push(`ha detto ${squadra}`);
    if (ruolo) motivi.push(`ha detto il ruolo`);
    if (secondo && stacco < 0.08) {
      motivi.push(`ma anche a ${secondo.voce.name}, troppo vicino per scegliere`);
    }
  }
  if (numeri.length === 0) motivi.push("nessun prezzo");
  else if (numeri.length > 1) motivi.push(`piu' numeri: ${numeri.join(", ")}`);
  if (compratori[0]) motivi.push(`acquirente ${compratori[0].voce.name}`);

  // Con piu' numeri si prende il piu' alto: il prezzo domina i numeri di
  // contorno, e comunque l'utente conferma.
  const prezzo = numeri.length ? Math.max(...numeri) : null;

  const sicuroNome = !!primo && primo.punteggio >= 0.8 && stacco >= 0.08 && !gia?.has(primo.voce.id);
  const confidenza =
    (sicuroNome ? 0.55 : primo ? 0.25 : 0) +
    (prezzo != null && numeri.length === 1 ? 0.3 : prezzo != null ? 0.15 : 0) +
    (compratori[0] ? 0.15 : 0);

  return {
    playerId: sicuroNome ? primo.voce.id : null,
    nomeGiocatore: primo?.voce.name ?? null,
    prezzo,
    partecipanteId: compratori[0]?.voce.id ?? null,
    nomePartecipante: compratori[0]?.voce.name ?? null,
    confidenza: Math.min(1, confidenza),
    perche: motivi.join("; "),
    squadraDetta: squadra,
    ruoloDetto: ruolo,
    altriGiocatori: giocatori.slice(0, 6).map((c) => ({
      id: c.voce.id,
      name: c.voce.name,
      team: c.voce.team,
      role: (c.voce as VoceListone).role ?? null,
      fullName: (c.voce as VoceListone).fullName ?? null,
      punteggio: Math.round(c.punteggio * 100) / 100,
    })),
  };
}

/**
 * Fra piu' trascrizioni della stessa frase, quella che regge di piu'.
 *
 * In una stanza che urla il riconoscitore non produce **una** trascrizione: ne
 * produce diverse, ordinate per quanto ci crede lui — che pero' ci crede in
 * base a quanto la frase suona come italiano, non a quanto somiglia a un
 * cognome del listone. "Cala Nogli" e' italiano piu' plausibile di
 * "Calhanoglu", e vince quasi sempre.
 *
 * Noi possiamo fare la domanda giusta: quale di queste, agganciata al listone,
 * da' una chiamata vera? E' gratis — sono confronti fra stringhe — e su una
 * frase difficile e' la differenza fra riconoscere e non riconoscere.
 */
export function interpretaAlternative(
  frasi: string[],
  listone: VoceListone[],
  partecipanti: Partecipante[],
  contesto?: ContestoChiamata,
): { chiamata: Chiamata; frase: string } | null {
  let migliore: { chiamata: Chiamata; frase: string } | null = null;
  for (const frase of frasi) {
    const testo = frase.trim();
    if (!testo) continue;
    const c = interpreta(testo, listone, partecipanti, contesto);
    // Un giocatore agganciato vale piu' di qualunque confidenza: e' la parte
    // che senza il listone non si puo' indovinare.
    const voto = (x: Chiamata) => (x.playerId ? 1 : 0) * 10 + x.confidenza;
    if (!migliore || voto(c) > voto(migliore.chiamata)) migliore = { chiamata: c, frase: testo };
  }
  return migliore;
}
