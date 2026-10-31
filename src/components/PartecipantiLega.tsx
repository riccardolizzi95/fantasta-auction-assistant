"use client";

import { useActionState, useState } from "react";
import {
  addParticipant,
  removeParticipant,
  updateParticipant,
  type AdminActionState,
} from "@/app/actions";

export type RigaSquadra = {
  id: string;
  name: string;
  budget_total: number;
  /** Ha un account con cui entra da solo, o l'ha aggiunta a mano chi conduce. */
  haAccount: boolean;
  /** Quanto ha gia' speso: e' il pavimento dei suoi crediti. */
  speso: number;
};

/**
 * Le squadre della lega, correggibili sul posto.
 *
 * Aggiungere e rimuovere non bastava. Le squadre che non hanno un account le
 * scrive a mano chi conduce l'asta, di corsa, spesso pochi minuti prima di
 * cominciare, e un nome storpiato si corregge li': rifare la squadra vorrebbe
 * dire perdere quello che ha gia' comprato.
 *
 * I crediti no: quelli sono una regola della lega, uguali per tutti, e si
 * cambiano nelle regole. Qui si vedono e basta.
 */
export default function PartecipantiLega({
  leagueId,
  squadre,
  meId,
  isOwner,
  inviteCode,
}: {
  leagueId: string;
  squadre: RigaSquadra[];
  meId: string | null;
  isOwner: boolean;
  inviteCode: string;
}) {
  const [apertaId, setApertaId] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-2">
        {squadre.map((s) =>
          isOwner && apertaId === s.id ? (
            <Correggi
              key={s.id}
              leagueId={leagueId}
              squadra={s}
              onDone={() => setApertaId(null)}
            />
          ) : (
            <div key={s.id} className="panel-flat flex items-center gap-3 px-3 py-2">
              <span className="flex-1 truncate text-sm font-medium">
                {s.name}
                {s.haAccount && <span className="chip ml-2">account</span>}
                {meId === s.id && (
                  <span
                    className="chip ml-2"
                    style={{ color: "var(--accent)", borderColor: "var(--accent-dim)" }}
                  >
                    tu
                  </span>
                )}
              </span>
              <span className="num text-xs text-[var(--text-faint)]">
                {s.budget_total} cr
                {s.speso > 0 && (
                  <span className="ml-1.5 text-[0.62rem]">· {s.speso} spesi</span>
                )}
              </span>
              {isOwner && (
                <button className="btn btn-sm" onClick={() => setApertaId(s.id)}>
                  Modifica
                </button>
              )}
              {isOwner && meId !== s.id && (
                <form action={removeParticipant}>
                  <input type="hidden" name="league_id" value={leagueId} />
                  <input type="hidden" name="participant_id" value={s.id} />
                  <button className="btn btn-sm btn-danger" type="submit">
                    Rimuovi
                  </button>
                </form>
              )}
            </div>
          ),
        )}
      </div>

      {isOwner && (
        <>
          <form action={addParticipant} className="mt-3 flex gap-2">
            <input type="hidden" name="league_id" value={leagueId} />
            <input name="name" placeholder="Nome di un altro fantallenatore" maxLength={40} />
            <button className="btn" type="submit">
              Aggiungi
            </button>
          </form>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-faint)]">
            Chi ha un account può entrare da solo con il codice{" "}
            <span className="num font-semibold text-[var(--text)]">{inviteCode}</span>. Gli altri li
            aggiungi tu a mano: bastano i nomi per tracciare chi compra cosa, e il nome si
            corregge quando vuoi. I crediti sono quelli della lega, uguali per tutti: si cambiano
            nelle regole qui sotto.
          </p>
        </>
      )}
    </>
  );
}

function Correggi({
  leagueId,
  squadra,
  onDone,
}: {
  leagueId: string;
  squadra: RigaSquadra;
  onDone: () => void;
}) {
  const [stato, azione, salvando] = useActionState(
    async (prev: AdminActionState, formData: FormData) => {
      const esito = await updateParticipant(prev, formData);
      if (esito?.ok) onDone();
      return esito;
    },
    null,
  );

  return (
    <form action={azione} className="panel-flat px-3 py-2">
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="participant_id" value={squadra.id} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={`n-${squadra.id}`}>Nome squadra</label>
          <input
            id={`n-${squadra.id}`}
            name="name"
            defaultValue={squadra.name}
            maxLength={40}
            required
          />
        </div>
        <button className="btn btn-primary" disabled={salvando}>
          {salvando ? "Salvo…" : "Salva"}
        </button>
        <button className="btn" type="button" disabled={salvando} onClick={onDone}>
          Annulla
        </button>
      </div>
      <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        I crediti sono <span className="num">{squadra.budget_total}</span> per tutti, come dicono le
        regole della lega
        {squadra.speso > 0 && (
          <>
            {" "}
            (ne ha già spesi <span className="num">{squadra.speso}</span>)
          </>
        )}
        .
      </p>
      {stato?.error && (
        <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--danger)]">{stato.error}</p>
      )}
    </form>
  );
}
