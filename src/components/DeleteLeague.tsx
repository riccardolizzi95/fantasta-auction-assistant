"use client";

import { useActionState, useState } from "react";
import { deleteLeague, type AdminActionState } from "@/app/actions";

/**
 * Cancellare una lega e' irreversibile e porta via rose e cronologia d'asta:
 * si conferma riscrivendone il nome, cosi' non succede per un clic distratto.
 */
export default function DeleteLeague({
  leagueId,
  leagueName,
  events,
}: {
  leagueId: string;
  leagueName: string;
  events: number;
}) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(deleteLeague, null);
  const [aperto, setAperto] = useState(false);

  return (
    <div className="panel border-[#5a2a2c] p-4">
      <h2 className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
        Cancella la lega
      </h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
        Spariscono partecipanti, strategie e {events > 0 ? `i ${events} acquisti registrati` : "la cronologia d'asta"}
        , per tutti i membri e senza possibilità di recupero. Listone e statistiche restano: sono
        dati condivisi fra tutte le leghe.
      </p>

      {!aperto ? (
        <button className="btn btn-sm btn-danger mt-3" onClick={() => setAperto(true)}>
          Voglio cancellare questa lega
        </button>
      ) : (
        <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="league_id" value={leagueId} />
          <div className="min-w-56 flex-1">
            <label htmlFor="conferma">
              Scrivi <span className="text-[var(--text)]">{leagueName}</span> per confermare
            </label>
            <input id="conferma" name="conferma" autoComplete="off" placeholder={leagueName} />
          </div>
          <button className="btn btn-sm btn-danger" disabled={pending}>
            {pending ? "Cancello…" : "Cancella definitivamente"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAperto(false)}>
            Annulla
          </button>
        </form>
      )}
      {state?.error && <p className="mt-2 text-xs text-[var(--danger)]">{state.error}</p>}
    </div>
  );
}
