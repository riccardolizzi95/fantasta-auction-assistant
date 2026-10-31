"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Aggiudicato from "@/components/auction/Aggiudicato";
import AgganciaSquadre from "@/components/AgganciaSquadre";
import AscoltoAsta from "@/components/auction/AscoltoAsta";
import ChiamataInCorso from "@/components/auction/ChiamataInCorso";
import AstaMobile from "@/components/auction/AstaMobile";
import { useLeague } from "@/components/LeagueDataProvider";
import { Bar, IconaCroce, IconaRiapri, IconaSposta, RoleBadge } from "@/components/ui";
import PlayerAnalysis from "./PlayerAnalysis";
import StrategyHealth, { InflazioneAsta } from "./StrategyHealth";
import RosaIdeale from "./RosaIdeale";
import { ROLES, ROLE_LABEL_SHORT, type PlayerWithStats, type Role } from "@/lib/fanta/types";
import { movimentiRecenti } from "@/lib/fanta/movimenti";
import { indicizza, paroleDi, punteggio } from "@/lib/fanta/ricerca";
import { conConsigli } from "@/lib/livelli";

export default function AuctionBoard() {
  const {
    loading,
    error,
    players,
    valuations,
    state,
    events,
    rimozioni,
    spostamenti,
    participants,
    me,
    playerMap,
    giocatoriInAsta,
    livello,
    league,
    isOwner,
    deleteEvent,
    setGiocatoreInAsta,
    setChiamataConfermata,
    lista,
  } = useLeague();
  /** Con una lista ristretta, chi non c'e' si cerca ma non si chiama. */
  const fuoriLista = (id: string) => lista.size > 0 && !lista.has(id);

  const movimenti = useMemo(
    () => movimentiRecenti(events, rimozioni, spostamenti),
    [events, rimozioni, spostamenti],
  );
  // Riaprire cancella un fatto registrato: e' una cosa da chi amministra, non
  // da chi conduce.
  const puoRiaprire = isOwner || livello === "admin";
  // Senza consigli sparisce ogni prezzo calcolato: nella ricerca, nella griglia
  // degli obiettivi e nell'analisi. Restano i nomi, le squadre e chi e' gia'
  // stato assegnato — cioe' quello che serve per registrare l'asta.
  const consigli = conConsigli(livello);

  const [query, setQuery] = useState("");
  /**
   * La lettera appena battuta entra subito nel campo, i risultati arrivano
   * dopo.
   *
   * Il campo e' la cosa che deve rispondere: se aspetta la lista, chi scrive
   * vede i caratteri comparire a scatti e crede che il software sia piantato.
   * `useDeferredValue` scinde le due cose — il cursore va, l'elenco si
   * aggiorna con la priorita' piu' bassa e puo' essere interrotto dalla
   * lettera successiva.
   */
  const queryTardiva = useDeferredValue(query);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * Chi e' sul piatto per tutta la lega.
   *
   * La sua scheda sta sotto la barra e ci resta finche' la chiamata e' aperta:
   * non c'e' piu' bisogno di dirottare la ricerca su di lui — che era il modo
   * di far vedere a tutti la stessa cosa, al prezzo di strapparti di mano
   * quello che stavi guardando. Adesso convivono: la chiamata in cima, e piu'
   * sotto chiunque tu voglia studiare mentre gli altri se la contendono.
   */
  const inAstaId = league.current_player_id ?? null;
  const chiamato = inAstaId ? (players.find((p) => p.id === inAstaId) ?? null) : null;
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");
  const inputRef = useRef<HTMLInputElement>(null);
  /** Chi stai per spostare l'asta addosso: il secondo click conferma. */
  const [sostituisci, setSostituisci] = useState<string | null>(null);
  /**
   * Se l'elenco dei risultati e' ancora aperto.
   *
   * Appena scegli, si chiude: hai scelto quello, gli altri quattro non servono
   * piu' e stavano solo spingendo la sua scheda sotto il bordo dello schermo.
   * Riscrivere nella ricerca lo riapre.
   */
  const [listaAperta, setListaAperta] = useState(true);
  const sinistra = useRef<HTMLElement>(null);
  const centro = useRef<HTMLDivElement>(null);
  /**
   * Lo stesso nodo, ma come stato.
   *
   * Un riferimento non fa ripartire niente quando si riempie, e la colonna
   * centrale nasce tardi — prima c'e' la scritta "carico listone". Chi deve
   * misurarla ha bisogno di sapere **quando** e' comparsa, e questo lo dice
   * solo uno stato.
   */
  const [colonnaCentrale, setColonnaCentrale] = useState<HTMLDivElement | null>(null);
  const destra = useRef<HTMLElement>(null);
  const ricerca = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  /** Se la barra dell'asta e' finita fuori schermo: allora ne serve un'eco a destra. */
  const [astaFuoriVista, setAstaFuoriVista] = useState(false);

  /**
   * La rotella scorre il centro, ovunque tu stia puntando.
   *
   * Tre colonne che scorrono ognuna per conto suo hanno un difetto: il mouse
   * sta quasi sempre fuori da quella che vuoi muovere, e la rotella non fa
   * niente. Chi legge una scheda con il puntatore fermo sul riquadro dei
   * crediti crede che la pagina sia bloccata.
   *
   * Regola: se il puntatore e' sopra una colonna laterale che **puo' ancora
   * scorrere**, comanda lei; altrimenti la rotella va al centro, che e' la
   * colonna lunga. Solo alla scrivania — sul telefono scorre la pagina, come
   * si aspetta chiunque.
   */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const c = centro.current;
      if (!c || c.offsetParent === null) return;
      const t = e.target as Node | null;
      if (t && c.contains(t)) return;
      const laterale =
        t && sinistra.current?.contains(t)
          ? sinistra.current
          : t && destra.current?.contains(t)
            ? destra.current
            : null;
      if (laterale) {
        const giu = e.deltaY > 0;
        const puoAncora = giu
          ? laterale.scrollTop + laterale.clientHeight < laterale.scrollHeight - 1
          : laterale.scrollTop > 0;
        if (puoAncora) return;
      }
      const passo = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? c.clientHeight : 1;
      c.scrollTop += e.deltaY * passo;
      e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  /**
   * Quando la barra esce dallo schermo, a destra compare la sua eco.
   *
   * Si guarda lo scorrimento invece di usare un `IntersectionObserver`: quello
   * consegna le sue misure solo quando la pagina viene disegnata davvero, e
   * una scheda in secondo piano — o una finestra nascosta — resterebbe con
   * l'eco sbagliata fino al primo ridisegno. Due rettangoli a scorrimento
   * costano molto meno di una chiamata persa.
   */
  useEffect(() => {
    const c = colonnaCentrale;
    if (!c) return;
    const guarda = () => {
      const b = barra.current;
      if (!b) return setAstaFuoriVista(false);
      setAstaFuoriVista(b.getBoundingClientRect().bottom < c.getBoundingClientRect().top + 8);
    };
    guarda();
    c.addEventListener("scroll", guarda, { passive: true });
    window.addEventListener("resize", guarda);
    // Piu' una controllata ogni mezzo secondo. Sembra ridondante e non lo e':
    // la barra si sposta anche senza che nessuno scorra — una chiamata che si
    // apre, una scheda che si allunga quando arrivano le statistiche — e in
    // quei casi l'evento di scorrimento non arriva mai. Sono due rettangoli.
    const battito = setInterval(guarda, 500);
    return () => {
      clearInterval(battito);
      c.removeEventListener("scroll", guarda);
      window.removeEventListener("resize", guarda);
    };
    // Dipende dal nodo, non solo dalla chiamata: la colonna centrale nasce
    // tardi — prima c'e' la scritta "carico listone" — e un effetto legato al
    // solo giocatore chiamato, quando le colonne comparivano davvero, non si
    // rifaceva piu'. L'eco non e' mai apparsa per questo.
  }, [colonnaCentrale, chiamato?.id]);

  /**
   * Porta la ricerca in cima: quando cominci a scrivere, e' li' che guardi.
   *
   * Dopo due fotogrammi, non subito: nell'istante in cui premi la prima lettera
   * i risultati non ci sono ancora, la colonna e' piu' corta di quanto sara', e
   * lo scorrimento si ferma a meta' strada. Si aspetta che la pagina si sia
   * ridisegnata e poi si va.
   */
  const ricercaInCima = useCallback(() => {
    // Secco, non animato. Lo scorrimento morbido su un contenitore che in quel
    // momento sta cambiando altezza qui non parte proprio — e comunque durante
    // un'asta mezzo secondo di animazione e' mezzo secondo in cui non vedi
    // quello che hai chiesto. Due passate: la seconda raccoglie l'assestamento
    // del riquadro che nel frattempo si e' riempito di risultati.
    const vai = () => {
      const c = centro.current;
      const r = ricerca.current;
      if (!c || !r) return;
      c.scrollTop += r.getBoundingClientRect().top - c.getBoundingClientRect().top - 8;
    };
    requestAnimationFrame(vai);
    setTimeout(vai, 120);
  }, []);

  /**
   * Si muove quando la ricerca passa da vuota a piena, e solo allora.
   *
   * In un effetto e non nel gestore del campo: il calcolo vuole la pagina gia'
   * ridisegnata con i risultati dentro, altrimenti la colonna e' piu' corta di
   * quanto sara' e lo scorrimento si ferma a meta' strada. L'effetto parte dopo
   * che React ha messo tutto nel documento, che e' il momento giusto.
   */
  const eraVuota = useRef(true);
  useEffect(() => {
    const piena = query.trim().length > 0;
    if (piena && eraVuota.current) ricercaInCima();
    eraVuota.current = !piena;
  }, [query, ricercaInCima]);

  // "/" mette il cursore nella ricerca: durante l'asta non c'e' tempo per il mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Chi resta, nei ruoli che devi ancora riempire.
   *
   * Il centro dello schermo, finche' non c'e' un giocatore aperto, era mezzo
   * schermo vuoto. Alla scrivania quello spazio deve dire la cosa che serve
   * sapere quando il banditore non ha ancora chiamato nessuno: **chi c'e'
   * ancora sul piatto**, ruolo per ruolo, e quanto costa. Cosi' si sa se
   * conviene aspettare o alzare la mano adesso.
   */
  const obiettivi = useMemo(() => {
    // Chi resta **e puo' essere chiamato**: proporre come obiettivo un
    // giocatore che la lega ha escluso e' peggio che non proporre niente.
    const rimasti = giocatoriInAsta.filter((p) => !state.takenPlayerIds.has(p.id));
    return ROLES.filter((r) => (state.me?.slotsLeft[r] ?? 1) > 0).map((r) => ({
      role: r,
      slots: state.me?.slotsLeft[r] ?? 0,
      lista: rimasti
        .filter((p) => p.role === r)
        .sort(
          (a, b) =>
            (valuations.byPlayer.get(b.id)?.baseValue ?? 0) -
            (valuations.byPlayer.get(a.id)?.baseValue ?? 0),
        )
        .slice(0, 6),
    }));
  }, [giocatoriInAsta, state.takenPlayerIds, state.me, valuations]);

  const cercando = query.trim().length > 0 || roleFilter !== "ALL";

  // L'indice si costruisce una volta sola: sono cinquecento giocatori e
  // rifarlo a ogni lettera digitata si sente.
  const indice = useMemo(
    () =>
      new Map(
        players.map((p) => [
          p.id,
          indicizza({ id: p.id, name: p.name, team: p.team, fullName: p.identity?.full_name }),
        ]),
      ),
    [players],
  );

  const results = useMemo(() => {
    const q = queryTardiva.trim();
    let pool = players;
    if (roleFilter !== "ALL") pool = pool.filter((p) => p.role === roleFilter);
    if (!q) {
      return pool
        .filter((p) => !state.takenPlayerIds.has(p.id))
        .map((p) => ({ p, score: valuations.byPlayer.get(p.id)?.baseValue ?? 0 }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 14)
        .map((x) => x.p);
    }
    const parole = paroleDi(queryTardiva);
    const scored: { p: PlayerWithStats; s: number }[] = [];
    for (const p of pool) {
      const idx = indice.get(p.id);
      if (!idx) continue;
      let s = punteggio(idx, parole);
      if (s === 0) continue;
      if (state.takenPlayerIds.has(p.id)) s -= 50;
      s += Math.min(20, (valuations.byPlayer.get(p.id)?.baseValue ?? 0) / 10);
      scored.push({ p, s });
    }
    return scored
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map((x) => x.p);
  }, [queryTardiva, players, roleFilter, state.takenPlayerIds, valuations, indice]);

  const selected = selectedId ? (players.find((p) => p.id === selectedId) ?? null) : null;

  if (loading) {
    return (
      <div className="py-20 text-center text-sm text-[var(--text-faint)]">
        Carico listone, statistiche e stato dell&apos;asta…
      </div>
    );
  }
  if (error) {
    return <div className="panel p-4 text-sm text-[var(--danger)]">Errore: {error}</div>;
  }
  if (players.length === 0) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-sm font-semibold">Il listone è vuoto</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[var(--text-muted)]">
          Carica il file ufficiale delle quotazioni per la stagione {state.league.season}: senza
          quello il software non ha nulla su cui calcolare i prezzi.
        </p>
        <Link href={`/lega/${state.league.id}/listone`} className="btn btn-primary btn-sm mt-4">
          Carica il listone
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Chi si e' aggiudicato il giocatore, scritto grande per qualche
          secondo. Sta qui, fuori dalle due disposizioni, perche' vale per
          tutte e due — in sala si guarda anche lo schermo del vicino. */}
      <Aggiudicato />
      {/* Se le squadre non battono col tabellone si scopre qui, in mezzo
          all'asta, non nella pagina della lista: e' li' che si guarda. */}
      <AgganciaSquadre leagueId={league.id} puoScrivere={isOwner} flottante />

      {/* Sullo schermo del telefono non serve tutto quello che serve alla
          scrivania: serve registrare in fretta quello che succede e sapere se
          te lo puoi permettere. Il listone e l'analisi completa, li', pesano. */}
      <div className="lg:hidden">
        <AstaMobile />
      </div>

      {/* Alla scrivania la pagina non deve scorrere tutta insieme. Mentre leggi
          l'analisi di un giocatore, i tuoi crediti e i budget degli avversari
          devono restare dove sono: sono le due cose che decidono se puoi
          permettertelo. Quindi ogni colonna scorre per conto suo dentro
          l'altezza dello schermo — 3.5rem di intestazione piu' 2rem di margini. */}
      <div className="hidden gap-4 lg:grid lg:h-[calc(100vh-5.5rem)] lg:grid-cols-[300px_minmax(0,1fr)_290px] lg:overflow-hidden">
        {/* ======================================= colonna sinistra: la tua situazione */}
        {/* `scrollbarGutter: stable` su tutte e tre: senza, la colonna si
            stringe di una quindicina di pixel nel momento in cui il contenuto
            diventa piu' alto dello schermo — e siccome a destra il contenuto
            cambia quando compare l'eco dell'asta, la colonna sembrava
            rimpicciolirsi da sola. */}
        <aside
          ref={sinistra}
          className="min-h-0 space-y-4 overflow-y-auto pr-1"
          // Lo scatto fra le due meta'.
          // `proximity` e non `mandatory`: dentro la scheda di un giocatore si
          // scorre libero — e' lunga e la si legge — ma quando ti avvicini al
          // confine la colonna si decide, o l'asta o la ricerca. A meta' non ci
          // resta.
          style={{ scrollbarGutter: "stable", scrollSnapType: "y proximity" }}
        >
          <StrategyHealth />
          {/* Sotto la salute della strategia perche' e' la stessa domanda vista
              da un'altra parte: quella dice se il piano regge, questa fa vedere
              che rosa ne verrebbe fuori. */}
          <RosaIdeale />
        </aside>

        {/* ======================================= centro: la chiamata, e sotto tutto il resto
            La barra dell'asta sta fissata in cima e non scorre mai: e' l'unica
            cosa che tutta la stanza guarda nello stesso momento, e perderla di
            vista scorrendo vorrebbe dire non sapere piu' a quanto siamo.
            Subito sotto c'e' la scheda di chi stanno chiamando. Piu' giu' la
            ricerca, che serve al caso opposto: quel giocatore non ti interessa,
            e mentre gli altri se lo contendono tu studi il prossimo. */}
        <div
          ref={(n) => {
            centro.current = n;
            setColonnaCentrale(n);
          }}
          className="min-h-0 space-y-4 overflow-y-auto pr-1"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="space-y-4">
            {/* La barra e la scheda sono un blocco solo.
                Sono due cose diverse — una e' l'asta, l'altra e' il giocatore —
                ma in quel momento sono la stessa domanda, e due riquadri
                staccati la spezzavano in due. La barra resta incollata in cima
                mentre la scheda le scorre sotto: `sticky`, non un riquadro
                fuori dallo scorrimento, cosi' il bordo fra le due non si apre
                mai. */}
            {chiamato && (
              <div ref={barra} style={{ scrollSnapAlign: "start" }}>
                <div className="sticky top-0 z-10">
                  <ChiamataInCorso unita />
                </div>
                <div
                  className="panel rounded-t-none border-t-0 p-4"
                  style={{ borderColor: "var(--accent-dim)" }}
                >
                  <PlayerAnalysis player={chiamato} />
                </div>
              </div>
            )}

            {/* Il confine fra le due meta' della colonna.
                Sopra c'e' l'asta di adesso, sotto c'e' quello che guardi tu:
                due cose diverse che scorrevano attaccate, e a colpo d'occhio
                sembravano lo stesso blocco. */}
            {chiamato && (
              <div className="flex items-center gap-2 pt-1">
                <span className="h-px flex-1" style={{ background: "var(--border)" }} />
                <span className="label-xs text-[var(--text-faint)]">
                  mentre l&apos;asta va avanti
                </span>
                <span className="h-px flex-1" style={{ background: "var(--border)" }} />
              </div>
            )}

            <div ref={ricerca} className="panel shrink-0 p-3" style={{ scrollSnapAlign: "start" }}>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setListaAperta(true);
                  }}
                  placeholder={
                    chiamato
                      ? "Cerca un altro giocatore  (premi / )"
                      : "Chi stiamo chiamando?  (premi / per cercare)"
                  }
                  autoComplete="off"
                />
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as Role | "ALL")}
                  className="w-28 shrink-0"
                  style={{ width: "7rem" }}
                >
                  <option value="ALL">Tutti</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL_SHORT[r]}
                    </option>
                  ))}
                </select>
                {/* Ripulire e' una cosa sola: il testo, il filtro e la scheda
                    che stavi guardando. Tre gesti per tornare al punto di
                    partenza erano due di troppo. */}
                {(cercando || selected) && (
                  <button
                    className="btn shrink-0"
                    title="Cancella la ricerca"
                    onClick={() => {
                      setQuery("");
                      setRoleFilter("ALL");
                      setSelectedId(null);
                      setListaAperta(true);
                      inputRef.current?.focus();
                    }}
                  >
                    <IconaCroce />
                  </button>
                )}
              </div>

              {/* La lista compare solo quando stai davvero cercando. A campo vuoto
                  ripeteva i piu' cari, che sono gia' li' sotto divisi per ruolo:
                  due liste che dicono la stessa cosa rubano lo spazio a quella
                  che serve. */}
              {cercando && listaAperta && (
                <div className="mt-2">
                  {results.length === 0 ? (
                    <p className="px-1 py-6 text-center text-xs text-[var(--text-faint)]">
                      Nessun giocatore trovato.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--border)]">
                      {results.map((p) => {
                        const v = valuations.byPlayer.get(p.id);
                        const taken = state.takenPlayerIds.has(p.id);
                        return (
                          <li key={p.id}>
                            <button
                              onClick={() => {
                                setSelectedId(p.id);
                                setListaAperta(false);
                              }}
                              className={`flex w-full items-center gap-2.5 px-1 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)] ${
                                selectedId === p.id ? "bg-[var(--bg-elevated)]" : ""
                              } ${taken ? "opacity-45" : ""}`}
                            >
                              <RoleBadge role={p.role} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {p.name}
                                  {fuoriLista(p.id) && (
                                    <span
                                      className="ml-1.5 text-[0.6rem] font-normal"
                                      style={{ color: "var(--warn)" }}
                                      title="Non è nella lista ristretta: non verrà chiamato"
                                    >
                                      fuori lista
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-[0.68rem] text-[var(--text-faint)]">
                                  {p.team}
                                  {taken && " · già assegnato"}
                                </span>
                              </span>
                              {consigli ? (
                                <span
                                  className="num shrink-0 text-sm font-bold"
                                  style={{ color: "var(--accent)" }}
                                >
                                  {Math.round(v?.baseValue ?? 1)}
                                </span>
                              ) : (
                                p.quotation_current != null && (
                                  <span className="num shrink-0 text-xs text-[var(--text-faint)]">
                                    {p.quotation_current}
                                  </span>
                                )
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {selected && selected.id !== chiamato?.id ? (
              <div className="panel p-4">
                {/* Chi conduce dichiara il giocatore in asta, e la scheda si apre
                    su tutti gli schermi della lega. Chi non ha il premium puo'
                    cercare quello che vuole, ma non sposta l'asta degli altri. */}
                {/* Aprire la chiamata su di lui.
                    Con un'altra chiamata gia' aperta il tasto non sparisce —
                    sparire e' il modo peggiore di dire di no, e il caso vero
                    c'e': il banditore e' passato al prossimo e quella di prima
                    nessuno l'ha chiusa. Serve pero' un secondo click, perche'
                    sostituirla cancella dagli schermi di tutti un'asta in
                    corso, prezzo compreso. */}
                {consigli && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      className={`btn btn-sm ${sostituisci === selected.id ? "btn-danger" : "btn-primary"}`}
                      disabled={fuoriLista(selected.id)}
                      title={
                        fuoriLista(selected.id)
                          ? "Non è nella lista ristretta della lega: non può essere chiamato"
                          : "Apre questa scheda su tutti gli schermi della lega"
                      }
                      onClick={async () => {
                        if (!chiamato) return void setGiocatoreInAsta(selected.id);
                        if (sostituisci !== selected.id) return setSostituisci(selected.id);
                        // Confermato a mano: se la chiamata era bloccata, la
                        // decisione di una persona la sblocca.
                        if (league.current_locked) await setChiamataConfermata(false);
                        await setGiocatoreInAsta(selected.id);
                        setSostituisci(null);
                      }}
                    >
                      {fuoriLista(selected.id)
                        ? "Fuori dalla lista: non chiamabile"
                        : !chiamato
                        ? "È lui che stanno chiamando"
                        : sostituisci === selected.id
                          ? `Confermi? Chiude la chiamata su ${chiamato.name}`
                          : "Sposta qui la chiamata"}
                    </button>
                    {chiamato && sostituisci !== selected.id && (
                      <span className="text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
                        C&apos;è una chiamata aperta su <strong>{chiamato.name}</strong>. Se è solo
                        il nome a essere sbagliato, correggilo dalla barra in alto: lì il prezzo
                        raggiunto non si perde.
                      </span>
                    )}
                  </div>
                )}
                <PlayerAnalysis player={selected} />
              </div>
            ) : chiamato ? null : (
              <div className="panel p-4">
                <p className="text-xs leading-relaxed text-[var(--text-faint)]">
                  {consigli
                    ? "Cerca chi è stato chiamato e ti dico quanto vale per la tua strategia, fino a dove puoi spingerti e cosa resta se lo perdi. Intanto, ecco chi c'è ancora nei ruoli che devi riempire."
                    : "Cerca chi è stato chiamato per vedere il suo storico e registrare a chi è andato."}
                </p>
                {consigli && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {obiettivi.map(({ role, slots, lista }) => (
                      <div key={role} className="panel-flat p-2">
                        <div className="mb-1.5 flex items-baseline justify-between px-1">
                          <span className="label-xs">{ROLE_LABEL_SHORT[role]}</span>
                          <span className="text-[0.62rem] text-[var(--text-faint)]">
                            {slots} da prendere
                          </span>
                        </div>
                        {lista.length === 0 ? (
                          <p className="px-1 py-2 text-[0.68rem] text-[var(--text-faint)]">
                            Non ne resta nessuno.
                          </p>
                        ) : (
                          <ul>
                            {lista.map((p) => (
                              <li key={p.id}>
                                <button
                                  onClick={() => setSelectedId(p.id)}
                                  className="flex w-full items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-[var(--bg-elevated)]"
                                >
                                  <span className="min-w-0 flex-1 truncate text-xs">{p.name}</span>
                                  <span
                                    className="num shrink-0 text-xs font-semibold"
                                    style={{ color: "var(--accent)" }}
                                  >
                                    {Math.round(valuations.byPlayer.get(p.id)?.baseValue ?? 1)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Spazio in fondo: senza, l'ultimo riquadro non puo' salire in cima
              allo schermo — e "portami la ricerca in alto" resterebbe a meta'
              strada ogni volta che la colonna finisce prima. Serve quasi
              un'altezza di schermo, perche' e' esattamente quello che manca
              sotto l'ultimo riquadro. */}
          <div aria-hidden style={{ height: "85vh" }} />
        </div>

        {/* ======================================= destra: microfono, lega e cronologia
            Una colonna sola che scorre tutta intera, come quella di sinistra.
            Prima le squadre stavano in un riquadro alto il 40% con un suo
            scorrimento dentro: otto squadre in una finestrella da tre, e per
            vedere la quarta bisognava indovinare che li' dentro si scorreva.
            Adesso ci sono tutte, e a scorrere e' la colonna. */}
        <aside
          ref={destra}
          className="min-h-0 space-y-4 overflow-y-auto pr-1"
          style={{ scrollbarGutter: "stable" }}
        >
          {/* L'ascolto resta incollato in cima: e' un interruttore, lo accendi
              una volta e non lo cerchi piu' — ma quando lo cerchi deve essere
              dov'era. C'e' per tutti, premium o no: un microfono in piu' in un
              altro punto della stanza fa arrivare la chiamata giusta a chi
              conduce, ed e' esattamente per questo che serve. */}
          <div
            className="sticky top-0 z-10 space-y-2 pb-2"
            style={{ background: "var(--bg)" }}
          >
            <AscoltoAsta />

            {/* L'eco dell'asta.
                Quando cerchi un altro giocatore la barra dell'asta e' finita
                fuori schermo, e per sapere a quanto sono arrivati dovresti
                risalire. Qui restano le tre cose che servono per non perdere il
                filo — chi, quanto, di chi — e un click riporta su. */}
            {astaFuoriVista && chiamato && (
              <button
                onClick={() => centro.current?.scrollTo({ top: 0 })}
                className="panel w-full px-3 py-2 text-left"
                style={{
                  borderColor: "var(--accent-dim)",
                  background: "color-mix(in srgb, var(--accent) 6%, var(--bg))",
                }}
                title="Torna alla chiamata"
              >
                <div className="flex items-center gap-2">
                  <span className="label-xs" style={{ color: "var(--accent)" }}>
                    in asta
                  </span>
                  <RoleBadge role={chiamato.role} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {chiamato.name}
                  </span>
                  <span className="num shrink-0 text-lg font-bold">
                    {league.current_price ?? "—"}
                  </span>
                </div>
                <div className="mt-0.5 text-[0.62rem] text-[var(--text-faint)]">
                  {league.current_bidder
                    ? `rilancio di ${participants.find((p) => p.id === league.current_bidder)?.name ?? "?"}`
                    : "nessuna offerta"}
                </div>
              </button>
            )}
          </div>

          <div className="panel">
            <header className="border-b border-[var(--border)] px-3 py-2">
              <h2 className="text-xs font-semibold">Squadre</h2>
            </header>
            <div className="divide-y divide-[var(--border)]">
              {state.teams
                .slice()
                .sort((a, b) => b.remaining - a.remaining)
                .map((t) => (
                  <div key={t.participant.id} className="px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-xs font-medium ${t.isMe ? "text-[var(--accent)]" : ""}`}
                      >
                        {t.participant.name}
                      </span>
                      <span className="num shrink-0 text-xs font-bold">{t.remaining}</span>
                    </div>
                    <div className="mt-1">
                      <Bar
                        value={t.remaining}
                        max={t.participant.budget_total}
                        color={t.isMe ? "var(--accent)" : "var(--border-strong)"}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[0.62rem] text-[var(--text-faint)]">
                      <span className="num">
                        {ROLES.map((r) => `${ROLE_LABEL_SHORT[r]} ${t.bought[r]}/${state.league.slots[r]}`).join(" · ")}
                      </span>
                      <span className="num">max {t.maxBid}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="panel">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <h2 className="text-xs font-semibold">Ultimi movimenti</h2>
              <span className="text-[0.62rem] text-[var(--text-faint)]">{events.length} chiamate</span>
            </header>
            <div className="divide-y divide-[var(--border)]">
              {movimenti.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-[var(--text-faint)]">
                  L&apos;asta non è ancora partita.
                </p>
              ) : (
                movimenti.map((m) => {
                  // Un annullamento e' la notizia piu' facile da non notare:
                  // l'acquisto sparisce, e senza questa riga nessuno saprebbe
                  // perche' quella rosa e' cambiata. Sta in mezzo agli altri
                  // movimenti, all'ora in cui e' successo.
                  if (m.tipo === "annullato") {
                    const { r } = m;
                    const p = playerMap.get(r.playerId);
                    const chi = participants.find((x) => x.id === r.participantId);
                    return (
                      <div
                        key={m.chiave}
                        className="flex items-center gap-2 px-3 py-1.5"
                        style={{ background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}
                      >
                        {p && <RoleBadge role={p.role} size="sm" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium line-through">
                            {p?.name ?? "?"}
                          </span>
                          <span
                            className="block truncate text-[0.62rem]"
                            style={{ color: "var(--warn)" }}
                          >
                            annullato · era di {chi?.name ?? "qualcuno"}
                          </span>
                        </span>
                        <span className="num shrink-0 text-xs" style={{ color: "var(--warn)" }}>
                          −{r.prezzo}
                        </span>
                      </div>
                    );
                  }

                  // Spostato, o corretto nella cifra: i crediti si sono mossi
                  // su due squadre insieme, e senza dirlo nessuno capirebbe
                  // perche' due budget sono cambiati da soli.
                  if (m.tipo === "spostato") {
                    const { s } = m;
                    const p = playerMap.get(s.playerId);
                    const nome = (id: string | null) =>
                      participants.find((x) => x.id === id)?.name ?? "qualcuno";
                    const cambiaSquadra = s.daParticipant !== s.aParticipant;
                    return (
                      <div
                        key={m.chiave}
                        className="flex items-center gap-2 px-3 py-1.5"
                        style={{ background: "color-mix(in srgb, var(--info) 8%, transparent)" }}
                      >
                        {p && <RoleBadge role={p.role} size="sm" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {p?.name ?? "?"}
                          </span>
                          <span
                            className="flex items-center gap-1 truncate text-[0.62rem]"
                            style={{ color: "var(--info)" }}
                          >
                            <IconaSposta size={10} />
                            {cambiaSquadra
                              ? `da ${nome(s.daParticipant)} a ${nome(s.aParticipant)}`
                              : `prezzo corretto · ${nome(s.aParticipant)}`}
                          </span>
                          <span className="num block truncate text-[0.62rem] text-[var(--text-faint)]">
                            {cambiaSquadra ? (
                              <>
                                {nome(s.daParticipant)}{" "}
                                <span style={{ color: "var(--accent)" }}>+{s.prezzoPrima}</span> ·{" "}
                                {nome(s.aParticipant)}{" "}
                                <span style={{ color: "var(--danger)" }}>−{s.prezzo}</span>
                              </>
                            ) : (
                              <>
                                {nome(s.aParticipant)}{" "}
                                <span
                                  style={{
                                    color:
                                      s.prezzo > s.prezzoPrima
                                        ? "var(--danger)"
                                        : "var(--accent)",
                                  }}
                                >
                                  {s.prezzo > s.prezzoPrima ? "−" : "+"}
                                  {Math.abs(s.prezzo - s.prezzoPrima)}
                                </span>{" "}
                                (da {s.prezzoPrima} a {s.prezzo})
                              </>
                            )}
                          </span>
                        </span>
                        <span className="num shrink-0 text-xs" style={{ color: "var(--info)" }}>
                          {s.prezzo}
                        </span>
                      </div>
                    );
                  }

                  const { e } = m;
                  const p = playerMap.get(e.player_id);
                  const buyer = participants.find((x) => x.id === e.participant_id);
                  const mine = e.participant_id && e.participant_id === me?.id;
                  return (
                    <div key={m.chiave} className="flex items-center gap-2 px-3 py-1.5">
                      {p && <RoleBadge role={p.role} size="sm" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{p?.name ?? "?"}</span>
                        <span className="block truncate text-[0.62rem] text-[var(--text-faint)]">
                          {e.outcome === "unsold" ? "non venduto" : (buyer?.name ?? "acquirente ignoto")}
                        </span>
                      </span>
                      <span
                        className="num shrink-0 text-xs font-bold"
                        style={{ color: mine ? "var(--accent)" : "var(--text-muted)" }}
                      >
                        {e.outcome === "unsold" ? "—" : e.price}
                      </span>
                      {/* Riaprire una chiamata sbagliata.
                          Chiuderla la puo' chiudere chi conduce; riaprirla no,
                          perche' vuol dire cancellare un fatto registrato e
                          rimettere la lega davanti a una decisione gia' presa.
                          Quella e' una cosa da amministratore. */}
                      {puoRiaprire && (
                        <button
                          className="shrink-0 text-[var(--text-faint)] hover:text-[var(--warn)]"
                          title="Riapri la chiamata: cancella la registrazione e rimette il giocatore in asta"
                          onClick={async () => {
                            await deleteEvent(e.id);
                            await setGiocatoreInAsta(e.player_id);
                          }}
                        >
                          <IconaRiapri />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* In fondo perche' e' un dato sul mercato, non su di te: si guarda
              ogni tanto, non a ogni chiamata. */}
          <InflazioneAsta />
        </aside>
      </div>
    </>
  );
}
