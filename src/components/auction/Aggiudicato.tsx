"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useLeague } from "@/components/LeagueDataProvider";
import { IconaCroce, IconaSposta, RoleBadge } from "@/components/ui";

/**
 * Cosa e' appena successo, detto forte una volta.
 *
 * In sala si sente male e si guarda lo schermo di qualcun altro. Una riga che
 * cambia in una tabella non basta: quando una chiamata si chiude, per qualche
 * secondo la cosa piu' importante dello schermo e' **chi l'ha preso e a
 * quanto**, e va scritto grande su tutti gli schermi insieme.
 *
 * Vale anche per le correzioni. Uno spostamento di rosa muove i crediti di due
 * squadre in una volta sola, ed era l'unica cosa che succedeva all'asta senza
 * che nessuno la vedesse.
 *
 * Arriva dagli eventi della lega, che sono gia' condivisi: nessun messaggio da
 * mandare, nessun ordine da rispettare. Se due schermi la vedono con mezzo
 * secondo di scarto non fa alcuna differenza.
 */
const DURATA_MS = 7000;

type Ruolo = "P" | "D" | "C" | "A" | null;

type Annuncio =
  | { tipo: "acquisto"; giocatore: string; ruolo: Ruolo; squadra: string | null; prezzo: number }
  | { tipo: "invenduto"; giocatore: string; ruolo: Ruolo }
  | {
      tipo: "spostato";
      giocatore: string;
      ruolo: Ruolo;
      da: string;
      a: string;
      prezzo: number;
      prezzoPrima: number;
    };

function Aggiudicato() {
  const { events, spostamenti, playerMap, participants } = useLeague();
  const [mostra, setMostra] = useState<Annuncio | null>(null);

  /**
   * L'ultimo evento che abbiamo gia' annunciato.
   *
   * Serve a non riannunciare al primo caricamento della pagina: chi entra a
   * meta' asta non deve vedersi sbattere in faccia l'acquisto di venti minuti
   * fa. Al primo giro si prende nota e non si dice niente.
   */
  const visto = useRef<string | null>(null);
  const primoGiro = useRef(true);

  useEffect(() => {
    const ultimo = [...events].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    )[0];
    // Il primo giro si archivia **sempre**, anche a lista vuota: altrimenti,
    // aprendo la pagina prima che l'asta cominci, la guardia si consumava sul
    // primo acquisto vero e quello — l'unico che contava — non si annunciava.
    if (primoGiro.current) {
      primoGiro.current = false;
      visto.current = ultimo?.id ?? "";
      return;
    }
    if (!ultimo) return;
    if (visto.current === ultimo.id) return;
    visto.current = ultimo.id;

    const p = playerMap.get(ultimo.player_id);
    setMostra(
      ultimo.outcome === "assigned"
        ? {
            tipo: "acquisto",
            giocatore: p?.name ?? "Giocatore",
            ruolo: p?.role ?? null,
            squadra: participants.find((x) => x.id === ultimo.participant_id)?.name ?? null,
            prezzo: ultimo.price,
          }
        : { tipo: "invenduto", giocatore: p?.name ?? "Giocatore", ruolo: p?.role ?? null },
    );
  }, [events, playerMap, participants]);

  /**
   * Le correzioni: stessa riga, altro padrone.
   *
   * Non hanno un evento nuovo da annunciare — l'acquisto e' lo stesso di
   * prima — quindi non passano dalla guardia qui sopra. Si riconoscono dalla
   * loro lista, che nasce vuota a ogni apertura di pagina: quello che ci
   * compare e' successo adesso, sotto gli occhi di chi guarda.
   */
  const vistoSpostamento = useRef<string | null>(null);
  useEffect(() => {
    const ultimo = spostamenti[0];
    if (!ultimo) return;
    const chiave = ultimo.playerId + "-" + ultimo.quando;
    if (vistoSpostamento.current === chiave) return;
    vistoSpostamento.current = chiave;
    const nome = (id: string | null) => participants.find((x) => x.id === id)?.name ?? "qualcuno";
    const p = playerMap.get(ultimo.playerId);
    setMostra({
      tipo: "spostato",
      giocatore: p?.name ?? "Giocatore",
      ruolo: p?.role ?? null,
      da: nome(ultimo.daParticipant),
      a: nome(ultimo.aParticipant),
      prezzo: ultimo.prezzo,
      prezzoPrima: ultimo.prezzoPrima,
    });
  }, [spostamenti, playerMap, participants]);

  /**
   * Il tempo dell'annuncio e' dell'annuncio, non di chi lo scopre.
   *
   * Il conto alla rovescia stava nell'effetto che scopre l'ultimo evento, e
   * quello si rifa' a ogni cambio degli eventi o dei partecipanti — durante
   * un'asta, in continuazione. Ogni volta la pulizia spegneva il timer, e
   * l'uscita anticipata ("questo l'ho gia' annunciato") non ne accendeva un
   * altro: il riquadro restava incollato in cima allo schermo per sempre.
   * Adesso il timer nasce e muore con l'annuncio, e con nient'altro.
   */
  useEffect(() => {
    if (!mostra) return;
    const t = setTimeout(() => setMostra(null), DURATA_MS);
    return () => clearTimeout(t);
  }, [mostra]);

  if (!mostra) return null;

  const colore =
    mostra.tipo === "acquisto"
      ? "var(--accent)"
      : mostra.tipo === "spostato"
        ? "var(--info)"
        : "var(--warn)";

  return (
    // Non un riquadro modale: non c'e' niente da confermare, e durante un'asta
    // un pannello che chiede un clic e' un pannello che qualcuno clicca al
    // volo senza leggerlo. Passa da solo — ma la crocetta c'e' lo stesso, per
    // chi ce l'ha davanti alla riga che sta leggendo.
    <div
      className="pointer-events-none fixed inset-x-0 top-28 z-50 flex justify-center px-4 lg:top-16"
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-auto relative flex items-center gap-4 overflow-hidden rounded-xl border py-3 pl-5 pr-3 shadow-2xl"
        style={{
          borderColor: colore,
          background: "var(--bg-elevated)",
          animation: "aggiudicato 0.25s ease-out",
        }}
      >
        {mostra.ruolo && <RoleBadge role={mostra.ruolo} />}
        <div>
          {mostra.tipo === "acquisto" && (
            <>
              <div className="text-xl font-bold leading-tight">
                {mostra.giocatore}
                <span className="text-[var(--text-faint)]"> a </span>
                <span style={{ color: "var(--accent)" }}>{mostra.squadra ?? "—"}</span>
              </div>
              <div className="num text-sm text-[var(--text-muted)]">{mostra.prezzo} crediti</div>
            </>
          )}
          {mostra.tipo === "invenduto" && (
            <>
              <div className="text-xl font-bold leading-tight">{mostra.giocatore}</div>
              <div className="text-sm" style={{ color: "var(--warn)" }}>
                non venduto
              </div>
            </>
          )}
          {mostra.tipo === "spostato" && (
            <>
              <div className="flex flex-wrap items-center gap-x-2 text-xl font-bold leading-tight">
                <span style={{ color: "var(--info)" }}>
                  <IconaSposta size={16} />
                </span>
                {mostra.giocatore}
                {mostra.da !== mostra.a && (
                  <>
                    <span className="text-[var(--text-faint)]">da</span>
                    <span>{mostra.da}</span>
                    <span className="text-[var(--text-faint)]">a</span>
                    <span style={{ color: "var(--info)" }}>{mostra.a}</span>
                  </>
                )}
              </div>
              <div className="num text-sm text-[var(--text-muted)]">
                {mostra.da !== mostra.a ? (
                  <>
                    {mostra.da} <span style={{ color: "var(--accent)" }}>+{mostra.prezzoPrima}</span>
                    <span className="text-[var(--text-faint)]"> · </span>
                    {mostra.a} <span style={{ color: "var(--danger)" }}>−{mostra.prezzo}</span>
                  </>
                ) : (
                  <>
                    prezzo corretto: da {mostra.prezzoPrima} a {mostra.prezzo} ·{" "}
                    <span
                      style={{
                        color:
                          mostra.prezzo > mostra.prezzoPrima ? "var(--danger)" : "var(--accent)",
                      }}
                    >
                      {mostra.a} {mostra.prezzo > mostra.prezzoPrima ? "−" : "+"}
                      {Math.abs(mostra.prezzo - mostra.prezzoPrima)}
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <button
          className="shrink-0 self-start rounded p-1 text-[var(--text-faint)] hover:text-[var(--text)]"
          title="Chiudi"
          aria-label="Chiudi l'annuncio"
          onClick={() => setMostra(null)}
        >
          <IconaCroce />
        </button>
        {/* Quanto manca, senza numeri: una riga che si consuma. Chi la vede
            sparire sa che il riquadro se ne sta andando da solo e non aspetta
            un suo clic. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left"
          style={{
            background: colore,
            animation: "conto " + DURATA_MS + "ms linear forwards",
          }}
        />
      </div>
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
export default memo(Aggiudicato);
