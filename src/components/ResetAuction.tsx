"use client";

import { useActionState, useState } from "react";
import { resetAuction, type AdminActionState } from "@/app/actions";

/**
 * Azzera l'asta per rifare una prova.
 *
 * Sta fra le cose pericolose e non fra i comandi normali, ma non e' la stessa
 * cosa che cancellare la lega: qui sparisce solo chi ha comprato chi. Il testo
 * lo dice, perche' e' esattamente la paura che uno ha con il dito sul pulsante.
 */
export default function ResetAuction({ leagueId, events }: { leagueId: string; events: number }) {
  const [stato, azione, inCorso] = useActionState<AdminActionState, FormData>(resetAuction, {});
  const [conferma, setConferma] = useState(false);

  return (
    <div className="panel border-[var(--warn)] p-4">
      <h2 className="text-sm font-semibold" style={{ color: "var(--warn)" }}>
        Azzera l&apos;asta
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
        Cancella <strong>solo</strong> chi ha comprato chi: {events} chiamate registrate. Giocatori,
        statistiche, identità, assenze, rigoristi, voci e strategie restano dove sono. Serve per fare
        una prova d&apos;asta e ripartire da zero.
      </p>

      {stato?.error && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {stato.error}
        </p>
      )}
      {stato?.ok && (
        <p className="mt-2 text-xs" style={{ color: "var(--accent)" }}>
          {stato.ok}
        </p>
      )}

      <form action={azione} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="league_id" value={leagueId} />
        {conferma ? (
          <>
            <button className="btn btn-sm btn-danger" type="submit" disabled={inCorso}>
              {inCorso ? "Azzero…" : `Confermo: cancella ${events} chiamate`}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setConferma(false)}>
              Annulla
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm"
            type="button"
            disabled={events === 0}
            onClick={() => setConferma(true)}
          >
            {events === 0 ? "L'asta è già vuota" : "Azzera l'asta"}
          </button>
        )}
      </form>
    </div>
  );
}
