"use client";

import { useActionState, useState } from "react";
import { setScalaPrezzi, type AdminActionState } from "@/app/actions";
import { Fisarmonica, Interruttore } from "@/components/ui";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/fanta/types";

const ROLE_COLOR: Record<Role, string> = {
  P: "var(--role-p)",
  D: "var(--role-d)",
  C: "var(--role-c)",
  A: "var(--role-a)",
};

/**
 * Quanto spendere sul primo, sul secondo, sul terzo di ogni reparto.
 *
 * E' il modo in cui si pianifica davvero un'asta — "un attaccante da 120, uno
 * da 80, quattro da 10" — e finora si poteva solo dire il totale del reparto.
 * Qui si scrive la forma, e il piano la segue alla lettera.
 */
export default function ScalaPrezzi({
  leagueId,
  participantId,
  budget,
  derivata,
  aMano,
  attiva,
}: {
  leagueId: string;
  participantId: string;
  budget: number;
  derivata: Record<string, number[]>;
  aMano: Record<string, number[]> | null;
  attiva: boolean;
}) {
  const [stato, azione, salvando] = useActionState<AdminActionState, FormData>(
    setScalaPrezzi,
    null,
  );
  // Spenta, la scala la deriva il software dalla strategia. Accenderla e'
  // una scelta, e si vede che lo e'.
  const [acceso, setAcceso] = useState(aMano != null);

  if (!attiva) {
    return (
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Scegli prima una strategia qui sopra: la scala parte da quella.
      </p>
    );
  }

  const totale = ROLES.reduce(
    (a, r) => a + (aMano?.[r] ?? derivata[r] ?? []).reduce((b, x) => b + x, 0),
    0,
  );

  return (
    <form action={azione}>
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="participant_id" value={participantId} />
      {/* Spento, salvare vuol dire "torna a quella automatica": e' la stessa
          azione, e non serve un secondo tasto per dirlo. */}
      {!acceso && <input type="hidden" name="azzera" value="si" />}

      <Interruttore
        acceso={acceso}
        onChange={setAcceso}
        titolo="Scrivo io quanto spendere su ognuno"
        sotto={
          <>
            Spento, la scala la deriva il software dalla strategia che hai scelto. Acceso, quello
            che scrivi <strong>vince su tutto</strong>: strategia, tetto, proporzioni.
          </>
        }
      />

      <Fisarmonica aperta={acceso}>
      <p className="mb-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        Dal più forte al meno forte, separati da virgola.
      </p>
      <div className="space-y-2">
        {ROLES.map((r) => {
          const valori = aMano?.[r] ?? derivata[r] ?? [];
          return (
            <div key={r} className="flex items-center gap-2">
              <span
                className="w-24 shrink-0 text-xs font-semibold"
                style={{ color: ROLE_COLOR[r] }}
              >
                {ROLE_LABEL[r]}
              </span>
              <input
                name={`scala_${r}`}
                defaultValue={valori.join(", ")}
                className="num flex-1 text-xs"
                disabled={!acceso}
                placeholder="es. 120, 80, 40, 10, 5, 1"
              />
              <span className="num w-14 shrink-0 text-right text-[0.68rem] text-[var(--text-faint)]">
                {valori.reduce((a, x) => a + x, 0)} cr
              </span>
            </div>
          );
        })}
      </div>

      </Fisarmonica>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={salvando}>
          {salvando ? "Salvo…" : acceso ? "Salva la scala" : "Salva"}
        </button>
        {acceso && aMano && (
          <button className="btn" name="azzera" value="si" disabled={salvando}>
            Torna a quella automatica
          </button>
        )}
        <span className="num text-xs text-[var(--text-faint)]">
          {totale} / {budget} crediti
        </span>
        {stato?.ok && (
          <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>
            ✓ {stato.ok}
          </span>
        )}
        {stato?.error && <span className="text-xs text-[var(--danger)]">{stato.error}</span>}
      </div>

      {aMano && (
        <p className="mt-2 text-[0.68rem] text-[var(--info)]">
          Stai usando una scala scritta a mano: il tetto per giocatore qui sopra non ha effetto.
        </p>
      )}
    </form>
  );
}
