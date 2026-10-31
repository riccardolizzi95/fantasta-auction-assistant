"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * La spazzata dello stato fisico, per chi amministra.
 *
 * E' l'unica cosa che il software non puo' dedurre dai numeri — un giocatore
 * fermo da tre settimane ha le stesse statistiche di uno in forma — ed e' anche
 * l'unica che invecchia in ore. Per questo il pannello mostra sempre **quando**
 * e' stata presa l'ultima volta: e' quella la cosa che decide se fidarsi.
 *
 * Si lancia il giorno prima dell'asta, non prima.
 */

type Progresso = {
  fatte: number;
  squadre: number;
  conStato: number;
  aggiornata: string | null;
  costo: number;
};

type Esito = {
  squadreFatte: number;
  fatte: number;
  squadre: number;
  done: boolean;
  trovati: number;
  costo: number;
  costoTotale: number;
  avvisi?: string[];
};

const quando = (iso: string | null) => {
  if (!iso) return "mai";
  const ore = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (ore < 1) return "meno di un'ora fa";
  if (ore < 24) return `${Math.round(ore)} ore fa`;
  return `${Math.round(ore / 24)} giorni fa`;
};

export default function StatoFisicoPanel() {
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<Esito | null>(null);
  // Un riferimento e non uno stato: serve a interrompere il giro in corso, e
  // deve essere leggibile dentro il ciclo senza aspettare un render.
  const fermare = useRef(false);

  // "Vecchio" si decide quando il dato arriva, non a ogni disegno: l'orologio
  // e' un'informazione di fuori, e leggerlo durante il render fa dire alla
  // stessa schermata cose diverse a distanza di un secondo.
  const [vecchio, setVecchio] = useState(false);

  const leggi = useCallback(async () => {
    const res = await fetch("/api/stato-fisico");
    if (!res.ok) return;
    const j = (await res.json()) as Progresso;
    setProgresso(j);
    setVecchio(
      !!j.aggiornata && Date.now() - new Date(j.aggiornata).getTime() > 48 * 3_600_000,
    );
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch("/api/stato-fisico")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Progresso | null) => {
        if (!vivo || !j) return;
        setProgresso(j);
        setVecchio(
          !!j.aggiornata && Date.now() - new Date(j.aggiornata).getTime() > 48 * 3_600_000,
        );
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const lancia = useCallback(
    async (ricomincia: boolean) => {
      setBusy(true);
      setErrore(null);
      fermare.current = false;
      try {
        let restart = ricomincia;
        for (let giro = 0; giro < 12; giro++) {
          if (fermare.current) break;
          const res = await fetch("/api/stato-fisico", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ restart }),
          });
          restart = false;
          if (!res.ok) {
            setErrore((await res.json().catch(() => ({})))?.error ?? `Errore ${res.status}`);
            break;
          }
          const j = (await res.json()) as Esito;
          setUltimo(j);
          await leggi();
          if (j.done || j.squadreFatte === 0) break;
        }
      } finally {
        setBusy(false);
      }
    },
    [leggi, fermare],
  );

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Stato fisico dei giocatori</h2>
        <span
          className="text-xs"
          style={{ color: vecchio ? "var(--warn)" : "var(--text-faint)" }}
        >
          aggiornato {quando(progresso?.aggiornata ?? null)}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
        Chi è infortunato, in dubbio o squalificato <strong>adesso</strong>. È l&apos;unica cosa che
        il software non può dedurre dai numeri, e l&apos;unica che invecchia in ore: va lanciata il
        giorno prima dell&apos;asta, non con settimane di anticipo. Una richiesta per squadra, circa
        <span className="num"> $0.15</span> per tutta la Serie A.
      </p>

      {progresso && (
        <p className="mt-2 text-xs text-[var(--text-faint)]">
          {progresso.fatte}/{progresso.squadre} squadre fatte in questo giro ·{" "}
          <span className="num">{progresso.conStato}</span> giocatori segnati come non disponibili
          {progresso.costo > 0 && (
            <>
              {" "}
              · speso <span className="num">${progresso.costo.toFixed(2)}</span>
            </>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {busy ? (
          <button
            className="btn btn-sm"
            onClick={() => {
              fermare.current = true;
            }}
          >
            Ferma
          </button>
        ) : (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => void lancia(true)}>
              Aggiorna tutte le squadre
            </button>
            {progresso && progresso.fatte > 0 && progresso.fatte < progresso.squadre && (
              <button className="btn btn-sm" onClick={() => void lancia(false)}>
                Riprendi da dove si era fermato
              </button>
            )}
          </>
        )}
        {busy && <span className="text-xs text-[var(--text-faint)]">chiedo squadra per squadra…</span>}
      </div>

      {ultimo && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Ultimo giro: {ultimo.squadreFatte} squadre, {ultimo.trovati} indisponibili trovati, $
          {ultimo.costo.toFixed(3)}.
          {ultimo.done && " Fatte tutte."}
        </p>
      )}

      {ultimo?.avvisi && ultimo.avvisi.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {ultimo.avvisi.map((a) => (
            <li key={a} className="text-[0.68rem] text-[var(--warn)]">
              {a}
            </li>
          ))}
        </ul>
      )}

      {errore && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {errore}
        </p>
      )}

      <p className="mt-3 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        Non tocca i prezzi: è la fonte meno affidabile che abbiamo, e un&apos;informazione sbagliata
        che dimezza un prezzo in silenzio sarebbe peggio di nessuna informazione. Compare nei contro
        della scheda, con la data.
      </p>
    </div>
  );
}
