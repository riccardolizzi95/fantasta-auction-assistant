"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLeague } from "@/components/LeagueDataProvider";
import { interpretaAlternative, type Chiamata } from "@/lib/fanta/astaVocale";
import { apriMicrofono, type Microfono } from "@/lib/fanta/microfono";
import { chiHaParlato, taraSullaLega } from "@/lib/fanta/voce";
import { abbonatiAiProfili, leggiProfili, profiliInMemoria } from "@/lib/fanta/vociLocali";
import { abbonatiAInGara, inGaraSulServer, leggiInGara, scriviInGara } from "@/lib/fanta/inGara";
import { fondi as fondiAscolti, FINESTRA_MS, type Sentito } from "@/lib/fanta/ascoltoCondiviso";
import { createClient } from "@/lib/supabase/client";
import { conConsigli } from "@/lib/livelli";
import { Aiuto } from "@/components/ui";

/**
 * Ascolta il banditore e alimenta la chiamata in corso.
 *
 * Il riconoscimento del parlato lo fa il browser; qui si aggancia quello che ha
 * sentito al listone, ai partecipanti e ai numeri — tre liste che conosciamo
 * gia'. E' questo che rende il problema affrontabile in una stanza rumorosa: non
 * si deve capire una lingua, si deve scegliere fra cinquecento possibilita'
 * note.
 *
 * **Non registra mai da solo.** Quello che sente finisce nella barra in cima —
 * il giocatore, la cifra, chi ha rilanciato — e li' una persona conferma. Un
 * comando che si spiega da solo e un pannello di correzioni in meno: la
 * correzione si fa dove si guarda, cioe' sulla barra.
 */

type Riconoscitore = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /** Quante trascrizioni diverse chiedere per la stessa frase. */
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type Alternative = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<Alternative>;
};

function costruttore(): (new () => Riconoscitore) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Riconoscitore;
    webkitSpeechRecognition?: new () => Riconoscitore;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function creaRiconoscitore(): Riconoscitore | null {
  const C = costruttore();
  return C ? new C() : null;
}

/**
 * Se il browser sa ascoltare.
 *
 * Non cambia mai durante la sessione, quindi non e' uno stato: e' una proprieta'
 * dell'ambiente, e si legge con `useSyncExternalStore` invece che con un effetto
 * che scrive stato. Sul server si assume di si', cosi' il pannello non compare
 * e sparisce a idratazione avvenuta.
 */
const nonCambiaMai = () => () => {};
let supportoLetto: boolean | null = null;
const leggiSupporto = () => {
  if (supportoLetto === null) supportoLetto = costruttore() != null;
  return supportoLetto;
};

type Proposta = Chiamata & {
  daModello?: boolean;
  /** La frase da cui e' nata: e' quello che fa capire perche' ha sbagliato. */
  sentito?: string;
  /** Quanti computer hanno sentito questa chiamata, se piu' di uno. */
  dispositivi?: number;
  /** L'acquirente non l'ha detto il banditore: l'ha riconosciuto dalla voce. */
  dallaVoce?: boolean;
  /** L'ha sentita un altro computer della lega, non il nostro microfono. */
  daAltri?: string;
};

/** Per quanto tempo una voce sentita resta buona per attribuire una chiamata. */
const VOCE_VALE_MS = 10_000;
/** Per quanto tempo una voce resta nell'elenco di chi si sta contendendo il giocatore. */
const IN_GARA_MS = 25_000;

/**
 * Quante trascrizioni chiedere per la stessa frase.
 *
 * Costano zero — il riconoscitore le ha gia' — e provarle tutte contro il
 * listone e' un confronto fra stringhe. Oltre la quinta sono rumore.
 */
const MAX_ALTERNATIVE = 5;

function AscoltoAsta() {
  const {
    giocatoriInAsta,
    playerMap,
    participants,
    state,
    livello,
    league,
    setGiocatoreInAsta,
    setOffertaCorrente,
  } = useLeague();
  const legaId = state.league.id;
  /** Come ci si presenta agli altri computer: il nome della squadra, non l'utente. */
  const nomeDelMioComputer = state.me?.participant.name ?? "un altro computer";
  const [attivo, setAttivo] = useState(false);
  const supportato = useSyncExternalStore(nonCambiaMai, leggiSupporto, () => true);
  const [trascrizione, setTrascrizione] = useState("");
  const [proposta, setProposta] = useState<Proposta | null>(null);
  // Chi ha parlato di recente, riconosciuto dalla voce. Sta fuori da React
  // perche' lo legge anche la scheda del giocatore, che e' altrove nell'albero.
  const inGara = useSyncExternalStore(abbonatiAInGara, leggiInGara, inGaraSulServer);
  const voci = useRef<{ id: string; nome: string; quando: number }[]>([]);
  const quanteVolte = useRef(new Map<string, number>());
  const microfono = useRef<Microfono | null>(null);

  // ---------------------------------------------------------------- piu' microfoni
  //
  // Se all'asta il software e' aperto anche su altri computer, stanno ascoltando
  // la stessa voce da un punto diverso della stanza. Quello che hanno capito
  // loro arriva qui e si fonde col nostro: dove uno ha preso il nome e l'altro
  // il prezzo, insieme fanno una chiamata intera.
  const supabase = useMemo(() => createClient(), []);
  const canale = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const sentiti = useRef<Sentito[]>([]);
  const nostroUltimo = useRef<Sentito | null>(null);
  const [altriComputer, setAltriComputer] = useState<string[]>([]);
  // Identifica il dispositivo, non la persona: due schede dello stesso browser
  // sono due orecchie, e va bene cosi'. Si genera fuori dal render, perche' un
  // render deve poter essere rifatto senza cambiare niente.
  const ioSono = useRef<string | null>(null);
  const chiSonoIo = () => {
    if (ioSono.current == null) ioSono.current = Math.random().toString(36).slice(2, 10);
    return ioSono.current;
  };
  const [errore, setErrore] = useState<string | null>(null);
  const rec = useRef<Riconoscitore | null>(null);
  // Il riconoscitore si ferma da solo dopo qualche secondo di silenzio: per
  // restare in ascolto per tutta l'asta va riavviato, ma solo finche' lo
  // vogliamo noi e non dopo uno stop chiesto dall'utente.
  const vuoleAscoltare = useRef(false);

  /**
   * Chi e' gia' stato venduto, in una forma che l'interprete puo' usare.
   *
   * E' l'informazione che il suono non ha: il banditore non richiama chi e' gia'
   * andato, e a meta' asta sono duecento nomi in meno fra cui sbagliare.
   */
  const gia = state.takenPlayerIds;

  /**
   * Quando il nome non serve piu' cercarlo.
   *
   * La chiamata bloccata vuol dire che qualcuno — una persona o il tabellone —
   * ha detto "e' lui": da quel momento al microfono resta la cifra. Sta in un
   * `ref` perche' lo legge il gestore del riconoscimento, che vive fuori dal
   * ciclo di disegno e vedrebbe un valore vecchio.
   */
  const chiamataBloccata = league.current_locked === true && league.current_player_id != null;
  const nomeNonServe = useRef(false);
  useEffect(() => {
    nomeNonServe.current = league.current_locked === true && league.current_player_id != null;
  }, [league.current_locked, league.current_player_id]);

  const chiediAlModello = useCallback(
    async (frase: string, locale: Proposta) => {
      try {
        const res = await fetch("/api/interpreta", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            frase,
            candidati: locale.altriGiocatori,
            partecipanti: participants.map((p) => ({ id: p.id, name: p.name })),
            gia: locale.altriGiocatori.filter((c) => gia.has(c.id)).map((c) => c.name),
          }),
        });
        if (!res.ok) return;
        const j = await res.json();
        if (!j.playerId) return;
        const dalModello: Proposta = {
          ...locale,
          playerId: j.playerId,
          nomeGiocatore: j.nomeGiocatore ?? locale.nomeGiocatore,
          prezzo: j.prezzo ?? locale.prezzo,
          // Se il banditore il nome l'ha detto davvero, quello vale piu' di una
          // voce riconosciuta: la voce serviva proprio perche' non l'aveva detto.
          partecipanteId: j.partecipanteId ?? locale.partecipanteId,
          nomePartecipante: j.nomePartecipante ?? locale.nomePartecipante,
          dallaVoce: j.partecipanteId ? false : locale.dallaVoce,
          confidenza: j.confidenza ?? locale.confidenza,
          perche: j.perche || locale.perche,
          daModello: true,
        };
        setProposta(dalModello);
      } catch {
        // Il modello e' un aiuto, non un requisito: se non risponde resta
        // quello che aveva capito la macchina locale.
      }
    },
    [participants, gia],
  );

  const profili = useSyncExternalStore(
    abbonatiAiProfili,
    () => leggiProfili(legaId),
    () => profiliInMemoria(legaId),
  );
  const metro = useMemo(() => (profili.length >= 2 ? taraSullaLega(profili) : null), [profili]);

  /**
   * Chi tiene il banco.
   *
   * Il banditore parla in continuazione, quindi la voce piu' recente e' quasi
   * sempre la sua — e attribuirgli ogni acquisto sarebbe peggio che non
   * attribuirne nessuno. Non serve pero' chiederlo: e' semplicemente quello che
   * ha parlato piu' di tutti, e lo si scopre da soli dopo qualche minuto d'asta.
   * Se il banditore e' esterno alla lega non viene riconosciuto e questo conto
   * resta innocuo.
   */
  const banditore = useCallback((): string | null => {
    let totale = 0;
    let capo: string | null = null;
    let max = 0;
    for (const [id, n] of quanteVolte.current) {
      totale += n;
      if (n > max) {
        max = n;
        capo = id;
      }
    }
    // Sotto una ventina di interventi non c'e' abbastanza per dirlo, e serve
    // che stacchi davvero: due persone che parlano uguale non sono un banditore.
    return totale >= 20 && max >= totale * 0.35 ? capo : null;
  }, []);

  /** L'ultima voce riconosciuta che non sia quella del banditore. */
  const chiHaAlzatoLaMano = useCallback((): { id: string; nome: string } | null => {
    const escluso = banditore();
    const ora = Date.now();
    for (let i = voci.current.length - 1; i >= 0; i--) {
      const v = voci.current[i];
      if (ora - v.quando > VOCE_VALE_MS) break;
      if (v.id !== escluso) return { id: v.id, nome: v.nome };
    }
    return null;
  }, [banditore]);

  /**
   * Rimette insieme quello che hanno sentito tutti i computer in ascolto.
   *
   * Si richiama sia quando sentiamo noi sia quando arriva la versione di un
   * altro, perche' l'ordine non e' garantito: la rete puo' consegnare la loro
   * mezzo secondo dopo la nostra.
   */
  const applicaFusione = useCallback(() => {
    const nostro = nostroUltimo.current;
    if (!nostro) return;
    const f = fondiAscolti(nostro, sentiti.current);
    if (f.dispositivi < 2) return;
    setProposta((prima) => {
      if (!prima) return prima;
      return {
        ...prima,
        playerId: f.playerId ?? prima.playerId,
        nomeGiocatore: f.nomeGiocatore ?? prima.nomeGiocatore,
        // Il prezzo di un'asta puo' solo salire: se qualcuno ha sentito un
        // rilancio in piu', quello e' il prezzo.
        prezzo:
          f.prezzo != null && (prima.prezzo == null || f.prezzo > prima.prezzo)
            ? f.prezzo
            : prima.prezzo,
        partecipanteId: prima.partecipanteId ?? f.partecipanteId,
        nomePartecipante: prima.nomePartecipante ?? f.nomePartecipante,
        dispositivi: f.dispositivi,
      };
    });
  }, []);

  /**
   * Quello che il microfono sente diventa la chiamata di tutta la lega.
   *
   * E' l'anello che mancava: si sentiva un rilancio, lo si vedeva qui, e sugli
   * altri schermi non succedeva niente — ognuno seguiva la stessa asta su una
   * pagina diversa. Adesso chi ascolta **conduce**: il giocatore riconosciuto
   * apre la chiamata su tutti, e ogni rilancio sentito aggiorna la cifra su
   * tutti.
   *
   * Con una differenza che vale piu' di tutto il resto: **una chiamata
   * confermata non si tocca**. Da li' in poi il microfono puo' solo far salire
   * la cifra, e un nome sentito male non porta piu' via il giocatore mentre il
   * banditore conta.
   */
  /**
   * Il canale con gli altri computer della lega, sempre aperto.
   *
   * Non dipende dal nostro microfono, ed e' il punto: **il telefono appoggiato
   * in mezzo al tavolo sente il banditore, il portatile dall'altra parte della
   * stanza no**. Se il canale si aprisse solo accendendo il proprio microfono,
   * quello che ha sentito il telefono non arriverebbe a chi conduce — che e'
   * esattamente il motivo per cui i microfoni si mettono insieme.
   *
   * E' un canale di transito: niente finisce nel database, perche' queste sono
   * ipotesi che valgono pochi secondi. Quello che resta e' l'acquisto
   * registrato, che passa dalla sua strada.
   */
  useEffect(() => {
    const ch = supabase.channel(`ascolto-${legaId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "sentito" }, ({ payload }) => {
      const s = payload as Sentito;
      if (!s || s.da === chiSonoIo()) return;
      sentiti.current = [...sentiti.current.filter((x) => x.da !== s.da), s].slice(-20);
      setAltriComputer([
        ...new Set(sentiti.current.filter((x) => Date.now() - x.quando < 60_000).map((x) => x.chi)),
      ]);
      const nostro = nostroUltimo.current;
      if (nostro && Date.now() - nostro.quando < FINESTRA_MS) {
        // Abbiamo sentito anche noi: le due versioni si fondono.
        applicaFusione();
        return;
      }
      // Noi non abbiamo sentito niente: la loro **diventa** la nostra proposta.
      // Senza questo, un computer con il microfono spento restava muto anche
      // quando quello accanto aveva capito tutto.
      if (!s.playerId && s.prezzo == null) return;
      setProposta({
        playerId: s.playerId,
        nomeGiocatore: s.nomeGiocatore,
        prezzo: s.prezzo,
        partecipanteId: s.partecipanteId,
        nomePartecipante: s.nomePartecipante,
        confidenza: s.confidenza,
        perche: `sentito da ${s.chi}`,
        altriGiocatori: [],
        daAltri: s.chi,
      });
    });
    void ch.subscribe();
    canale.current = ch;
    return () => {
      void supabase.removeChannel(ch);
      canale.current = null;
    };
  }, [supabase, legaId, applicaFusione]);

  /**
   * Quello che abbiamo gia' consegnato alla lega.
   *
   * Serve per non consegnarlo due volte, e per non consegnarlo mai piu' dopo:
   * fra il momento in cui scriviamo e quello in cui la lega ce lo rimanda
   * passano decimi di secondo in cui il componente si ridisegna piu' volte, e
   * senza questo la stessa frase partirebbe tre volte. Peggio: se nel
   * frattempo una persona ha corretto la cifra a mano, ripeterla vorrebbe dire
   * scavalcarla — e fra il microfono e una persona ha ragione la persona.
   */
  const consegnato = useRef("");
  useEffect(() => {
    if (!conConsigli(livello)) return;

    const inCorso = league.current_player_id ?? null;
    // Chiamata chiusa: quello che avevamo consegnato non vale piu', e la
    // prossima volta che lo sentiamo va consegnato di nuovo.
    if (inCorso == null) consegnato.current = "";
    if (!proposta) return;

    const bloccata = inCorso != null && league.current_locked === true;
    // Con la chiamata confermata il nome non si tocca: al microfono resta la
    // cifra, che e' l'unica cosa che durante una chiamata cambia davvero.
    const giocatore = bloccata ? inCorso : (proposta.playerId ?? inCorso);
    if (!giocatore) return;

    const prezzo = proposta.prezzo ?? null;
    const chi = proposta.partecipanteId ?? null;
    const chiave = `${giocatore}|${prezzo}|${chi}`;
    if (consegnato.current === chiave) return;

    const cambiaGiocatore = giocatore !== inCorso;
    const cambiaOfferta =
      prezzo != null &&
      (prezzo !== (league.current_price ?? null) || chi !== (league.current_bidder ?? null));
    if (!cambiaGiocatore && !cambiaOfferta) return;

    consegnato.current = chiave;
    void (async () => {
      // **In fila, non insieme.** Aprire una chiamata azzera l'offerta, quindi
      // se le due scritture partono affiancate vince chi arriva ultima: si
      // sentiva "Carnesecchi a 100 da Giorgio", partivano entrambe, e la
      // barra restava a "— crediti". La prima deve finire prima che parta la
      // seconda.
      if (cambiaGiocatore) await setGiocatoreInAsta(giocatore);
      if (prezzo != null) await setOffertaCorrente(prezzo, chi ?? league.current_bidder ?? null);
    })();
  }, [
    livello,
    proposta,
    league.current_player_id,
    league.current_price,
    league.current_bidder,
    league.current_locked,
    setGiocatoreInAsta,
    setOffertaCorrente,
  ]);

  const ascolta = useCallback(() => {
    const r = creaRiconoscitore();
    if (!r) {
      setErrore("Questo browser non sa ascoltare.");
      return;
    }
    r.lang = "it-IT";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = MAX_ALTERNATIVE;

    r.onresult = (e) => {
      // Ogni risultato porta piu' trascrizioni della stessa frase, ordinate da
      // quanto suonano come italiano. La prima e' spesso la peggiore per noi:
      // "Cala Nogli" e' italiano piu' plausibile di "Calhanoglu".
      const finali: string[][] = [];
      let parziale = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const ris = e.results[i];
        if (ris.isFinal) {
          const varianti: string[] = [];
          for (let k = 0; k < Math.min(ris.length, MAX_ALTERNATIVE); k++) {
            const t = ris[k]?.transcript?.trim();
            if (t) varianti.push(t);
          }
          if (varianti.length) finali.push(varianti);
        } else parziale += ris[0].transcript;
      }
      const prime = finali.map((v) => v[0]).join(" ").trim();
      setTrascrizione(prime || parziale.trim());
      if (!prime) return;

      // Se il pezzo finale e' uno solo si provano tutte le sue varianti; se
      // sono piu' d'uno si prova la frase intera, perche' incrociare le
      // varianti di ognuna sarebbe un prodotto cartesiano per niente.
      const candidate = finali.length === 1 ? finali[0] : [prime];
      // Il microfono sceglie fra chi puo' essere chiamato davvero: con una
      // lista ristretta, agganciare un nome fuori lista vorrebbe dire aprire
      // una chiamata che la lega ha deciso di non fare.
      const scelta = interpretaAlternative(
        candidate,
        giocatoriInAsta.map((p) => ({
          id: p.id,
          name: p.name,
          team: p.team,
          // Il ruolo scioglie gli omonimi che la squadra non scioglie: i due
          // Martinez sono entrambi dell'Inter, ma uno para.
          role: p.role,
          fullName: p.identity?.full_name ?? null,
        })),
        participants.map((p) => ({ id: p.id, name: p.name })),
        { gia },
      );
      if (!scelta) return;
      const locale = scelta.chiamata;
      // Una frase senza niente dentro non e' una proposta: il banditore parla
      // molto piu' di quanto aggiudichi.
      if (!locale.nomeGiocatore && locale.prezzo == null) return;
      const arrivata: Proposta = { ...locale, sentito: scelta.frase };
      // Il banditore ha detto nome e prezzo ma non a chi: l'ultima voce che ha
      // parlato, e che non e' la sua, e' quasi sempre chi se l'e' preso.
      if (!arrivata.partecipanteId) {
        const alzata = chiHaAlzatoLaMano();
        if (alzata) {
          arrivata.partecipanteId = alzata.id;
          arrivata.nomePartecipante = alzata.nome;
          arrivata.dallaVoce = true;
        }
      }
      setProposta(arrivata);

      // Quello che abbiamo capito noi parte verso gli altri computer, e poi si
      // rifonde con quello che nel frattempo hanno capito loro.
      const nostro: Sentito = {
        da: chiSonoIo(),
        chi: nomeDelMioComputer,
        quando: Date.now(),
        playerId: arrivata.playerId,
        nomeGiocatore: arrivata.nomeGiocatore,
        prezzo: arrivata.prezzo,
        partecipanteId: arrivata.partecipanteId,
        nomePartecipante: arrivata.nomePartecipante,
        confidenza: arrivata.confidenza,
        forza: 0.5,
      };
      nostroUltimo.current = nostro;
      void canale.current?.send({ type: "broadcast", event: "sentito", payload: nostro });
      // Gli altri possono aver gia' parlato: la fusione va fatta subito, non
      // solo quando arriva un messaggio.
      sentiti.current = sentiti.current.filter((x) => Date.now() - x.quando < FINESTRA_MS);
      applicaFusione();
      /**
       * Il modello si chiama solo se il nome serve.
       *
       * Con la chiamata bloccata — ed e' sempre cosi' quando comanda il ponte,
       * perche' il giocatore arriva dal tabellone — l'unica cosa che cambia e'
       * la cifra, e le cifre le riconosce il riconoscimento locale senza
       * sbagliare. Chiedere a un modello di indovinare un nome che sappiamo
       * gia' e' tempo e denaro buttati a ogni rilancio.
       */
      const nomeSuperfluo =
        nomeNonServe.current || (arrivata.prezzo != null && !arrivata.nomeGiocatore);
      if (arrivata.confidenza < 0.75 && arrivata.altriGiocatori.length > 0 && !nomeSuperfluo) {
        void chiediAlModello(scelta.frase, arrivata);
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") {
        setErrore("Il browser non ha dato accesso al microfono.");
        vuoleAscoltare.current = false;
        setAttivo(false);
      }
    };
    r.onend = () => {
      if (vuoleAscoltare.current) {
        try {
          r.start();
        } catch {
          /* gia' partito */
        }
      } else setAttivo(false);
    };

    rec.current = r;
    vuoleAscoltare.current = true;
    setErrore(null);
    r.start();
    setAttivo(true);

    // Il secondo ascolto: lo stesso microfono, ma per capire **chi** parla.
    // E' un di piu': se non ci sono voci registrate, o il browser non lo
    // concede, l'asta si segue lo stesso.
    if (metro && profili.length >= 2 && !microfono.current) {
      void apriMicrofono({
        onSegmento: (seg) => {
          const chi = chiHaParlato(seg.impronta, profili, metro);
          if (!chi) return;
          quanteVolte.current.set(
            chi.participantId,
            (quanteVolte.current.get(chi.participantId) ?? 0) + 1,
          );
          const ora = Date.now();
          voci.current.push({ id: chi.participantId, nome: chi.nome, quando: ora });
          if (voci.current.length > 400) voci.current.splice(0, 200);
          const escluso = banditore();
          const recenti = new Map<string, { id: string; nome: string; quando: number }>();
          for (const v of voci.current) {
            if (ora - v.quando > IN_GARA_MS || v.id === escluso) continue;
            recenti.set(v.id, v);
          }
          scriviInGara([...recenti.values()].sort((a, b) => b.quando - a.quando));
        },
      })
        .then((m) => {
          microfono.current = m;
        })
        .catch(() => {
          /* niente riconoscimento delle voci: il resto funziona uguale */
        });
    }
  }, [
    giocatoriInAsta,
    participants,
    chiediAlModello,
    metro,
    profili,
    banditore,
    chiHaAlzatoLaMano,
    applicaFusione,
    nomeDelMioComputer,
    gia,
  ]);

  const smetti = useCallback(() => {
    // Il canale resta aperto: smettere di ascoltare vuol dire smettere di
    // mandare quello che sentiamo noi, non smettere di ricevere quello che
    // sentono gli altri.
    vuoleAscoltare.current = false;
    rec.current?.stop();
    microfono.current?.chiudi();
    microfono.current = null;
    scriviInGara([]);
    setAttivo(false);
  }, []);

  useEffect(
    () => () => {
      vuoleAscoltare.current = false;
      rec.current?.stop();
      microfono.current?.chiudi();
      microfono.current = null;
    },
    [],
  );

  if (!supportato) {
    return (
      <div className="panel-flat p-3 text-xs text-[var(--text-faint)]">
        Questo browser non sa ascoltare. Serve Chrome, Edge o Safari: su Firefox il
        riconoscimento vocale non c&apos;è.
      </div>
    );
  }

  const conduce = conConsigli(livello);
  const inCorso = league.current_player_id ? playerMap.get(league.current_player_id) : null;
  // Un nome sentito mentre la chiamata era gia' confermata su un altro: non e'
  // uno stato, e' una differenza fra due cose che gia' sappiamo.
  const scartato =
    league.current_locked === true &&
    proposta?.playerId &&
    proposta.playerId !== league.current_player_id
      ? proposta.nomeGiocatore
      : null;

  return (
    <div className="panel-flat shrink-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`btn btn-sm ${attivo ? "" : "btn-primary"}`}
          onClick={attivo ? smetti : ascolta}
        >
          {attivo ? "Smetti di ascoltare" : "Ascolta l'asta"}
        </button>
        {/* A cosa serve sta in una ⓘ, non in tre righe di testo: e' una cosa
            che si legge una volta all'inizio dell'asta, e per il resto del
            pomeriggio quelle righe occupavano lo spazio della colonna.
            E non e' la stessa cosa per tutti — chi conduce muove la barra di
            tutta la lega, chi non conduce mette a disposizione un orecchio in
            piu', che e' il motivo per cui il tasto c'e' anche senza premium. */}
        <Aiuto largo={19}>
          {conduce
            ? "Sente il banditore e riempie da solo la barra in cima: il giocatore chiamato, la cifra e chi ha rilanciato, su tutti gli schermi della lega. Non registra niente da solo — confermi tu."
            : "Accendilo e diventi un orecchio in più per la lega: quello che senti da qui va agli altri computer e si somma al loro, così la chiamata arriva giusta anche a chi è lontano dal banditore. Da qui non muovi niente sugli schermi degli altri."}
        </Aiuto>
        {attivo && (
          <span className="ml-auto flex items-center gap-1.5 text-[0.68rem]" style={{ color: "var(--danger)" }}>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--danger)" }}
            />
            acceso
          </span>
        )}
      </div>


      {attivo && (
        <p className="mt-2 min-h-[1.2rem] text-xs italic text-[var(--text-faint)]">
          {trascrizione || "in ascolto…"}
        </p>
      )}

      {/* L'ultima cosa capita, in chiaro. Non e' un modulo da correggere: e' il
          modo di accorgersi che sta sbagliando, e la correzione si fa sulla
          barra, dove tutti guardano. */}
      {(attivo || proposta?.daAltri) && proposta && (
        <p className="mt-1 text-[0.68rem] leading-relaxed text-[var(--text-muted)]">
          {proposta.nomeGiocatore ??
            (chiamataBloccata
              ? "il giocatore lo dice il tabellone: ascolto le cifre"
              : "nessun nome riconosciuto")}
          {proposta.prezzo != null && <span className="num"> · {proposta.prezzo}</span>}
          {proposta.nomePartecipante && ` · ${proposta.nomePartecipante}`}
          {proposta.daModello && (
            <span className="chip ml-1.5" style={{ color: "var(--info)" }}>
              dal modello
            </span>
          )}
          {proposta.dispositivi != null && proposta.dispositivi > 1 && (
            <span className="chip ml-1.5" style={{ color: "var(--info)" }}>
              {proposta.dispositivi} computer
            </span>
          )}
          {proposta.dallaVoce && (
            <span className="chip ml-1.5" style={{ color: "var(--warn)" }}>
              dalla voce
            </span>
          )}
          {proposta.daAltri && (
            <span className="chip ml-1.5" style={{ color: "var(--info)" }}>
              da {proposta.daAltri}
            </span>
          )}
        </p>
      )}

      {/* Quando la chiamata e' confermata il microfono non puo' piu' cambiare
          il nome. Se ne sente un altro non lo si butta in silenzio: si dice,
          perche' potrebbe voler dire che il banditore e' andato avanti. */}
      {scartato && inCorso && (
        <p className="mt-1.5 text-[0.68rem] leading-relaxed" style={{ color: "var(--warn)" }}>
          Ho sentito «{scartato}», ma la chiamata è confermata su {inCorso.name}: se è passato
          davvero al prossimo, chiudi questa.
        </p>
      )}

      {/* Chi si sta contendendo il giocatore, riconosciuto dalla voce. Anche
          quando il banditore non dice mai i nomi, sapere che stanno rilanciando
          in due, e chi sono, cambia fin dove conviene spingersi. */}
      {attivo && inGara.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="label-xs">sento rilanciare</span>
          {inGara.map((v) => (
            <span key={v.id} className="chip" style={{ color: "var(--warn)" }}>
              {v.nome}
            </span>
          ))}
        </div>
      )}

      {attivo && altriComputer.length > 0 && (
        <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
          In ascolto anche {altriComputer.join(", ")}: quello che sente ognuno si somma.
        </p>
      )}

      {attivo && profili.length < 2 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[0.62rem] text-[var(--text-faint)]">
          riconosce solo le parole
          <Aiuto largo={17}>
            Registrando le voci nelle impostazioni della lega, riconosce anche chi rilancia quando
            il banditore non lo dice.
          </Aiuto>
        </p>
      )}

      {errore && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {errore}
        </p>
      )}
    </div>
  );
}

/**
 * Fermo quando cambia solo la ricerca.
 *
 * La ricerca dell'asta vive nel componente padre: ogni lettera battuta lo
 * ridisegna, e con lui ridisegnava tutto quello che ci sta dentro — la scheda
 * del giocatore, la rosa, i pannelli — che con la ricerca non c'entrano
 * niente. I conti non erano il problema (cercare fra cinquecento giocatori
 * costa meno di un millisecondo): era il ridisegno. Le proprieta' qui non
 * cambiano mai mentre si scrive, quindi si salta; quello che arriva dal
 * contesto della lega passa lo stesso, come deve.
 */
export default memo(AscoltoAsta);
