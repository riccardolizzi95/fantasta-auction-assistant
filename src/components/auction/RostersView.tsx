"use client";

import { Fragment, useState } from "react";
import { useLeague } from "@/components/LeagueDataProvider";
import { Bar, Empty, RoleBadge, Stat } from "@/components/ui";
import { perchePrezzoImpossibile } from "@/lib/fanta/market";
import { conConsigli } from "@/lib/livelli";
import { ROLES, ROLE_LABEL, STARTERS_PER_TEAM, type Role } from "@/lib/fanta/types";

const ROLE_COLOR: Record<Role, string> = {
  P: "var(--role-p)",
  D: "var(--role-d)",
  C: "var(--role-c)",
  A: "var(--role-a)",
};

export default function RostersView() {
  const { loading, state, league, me, isOwner, livello } = useLeague();
  // Senza consigli restano i fatti della rosa: chi, a quanto, quanto e' rimasto.
  // Sparisce il giudizio — valore acquistato, efficienza, punti attesi.
  const consigli = conConsigli(livello);
  const [openId, setOpenId] = useState<string | null>(me?.id ?? null);
  /** L'acquisto che si sta correggendo, se ce n'e' uno. */
  const [correggo, setCorreggo] = useState<string | null>(null);

  if (loading) {
    return <div className="py-20 text-center text-sm text-[var(--text-faint)]">Carico le rose…</div>;
  }

  return (
    <div className="space-y-4">
      {state.teams.map((t) => {
        const open = openId === t.participant.id;
        const spentValue = t.roster.reduce((a, r) => a + (r.valuation?.baseValue ?? 0), 0);
        const efficiency = t.spent > 0 ? spentValue / t.spent : 0;

        // Punti attesi dalla formazione titolare con la rosa attuale.
        let projected = 0;
        for (const r of ROLES) {
          const pool = t.roster
            .filter((x) => x.player.role === r)
            .map((x) => x.valuation)
            .filter(Boolean)
            .sort((a, b) => (b!.effFM ?? 0) - (a!.effFM ?? 0));
          let slotsLeft = STARTERS_PER_TEAM[r];
          for (const v of pool) {
            if (slotsLeft <= 0) break;
            projected += Math.min(1, slotsLeft) * (v!.effFM * Math.min(1, v!.expApps / 34));
            slotsLeft -= 1;
          }
        }

        return (
          <section key={t.participant.id} className="panel">
            <button
              onClick={() => setOpenId(open ? null : t.participant.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold">{t.participant.name}</span>
                  {t.isMe && (
                    <span className="chip" style={{ color: "var(--accent)", borderColor: "var(--accent-dim)" }}>
                      tu
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--text-faint)]">
                  {t.roster.length}/{ROLES.reduce((a, r) => a + league.slots[r], 0)} giocatori ·{" "}
                  {t.spent} crediti spesi · {t.remaining} residui
                </span>
              </span>
              {consigli && (
                <span className="num hidden text-right sm:block">
                  <span className="block text-[0.62rem] uppercase tracking-wide text-[var(--text-faint)]">
                    punti/giornata
                  </span>
                  <span className="text-lg font-bold" style={{ color: "var(--accent)" }}>
                    {projected.toFixed(1)}
                  </span>
                </span>
              )}
              <span className="text-[var(--text-faint)]">{open ? "−" : "+"}</span>
            </button>

            {open && (
              <div className="border-t border-[var(--border)] p-4">
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Spesi" value={t.spent} hint={`${t.remaining} residui`} />
                  {consigli && (
                    <>
                      <Stat
                        label="Valore acquistato"
                        value={Math.round(spentValue)}
                        hint="somma dei prezzi giusti"
                      />
                      <Stat
                        label="Efficienza"
                        value={`${(efficiency * 100).toFixed(0)}%`}
                        tone={efficiency >= 1.05 ? "good" : efficiency < 0.85 ? "bad" : "default"}
                        hint={
                          efficiency >= 1.05
                            ? "sta comprando sotto valore"
                            : efficiency < 0.85
                              ? "sta pagando sopra valore"
                              : "in linea col mercato"
                        }
                      />
                    </>
                  )}
                  <Stat
                    label="Max offerta"
                    value={t.maxBid}
                    hint={`${t.totalSlotsLeft} slot da riempire`}
                  />
                </div>

                {t.roster.length === 0 ? (
                  <Empty>Nessun giocatore acquistato.</Empty>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {ROLES.map((r) => {
                      const list = t.roster.filter((x) => x.player.role === r);
                      return (
                        <div key={r}>
                          <div className="mb-1.5 flex items-baseline justify-between">
                            <span className="label-xs" style={{ color: ROLE_COLOR[r] }}>
                              {ROLE_LABEL[r]}
                            </span>
                            <span className="num text-[0.68rem] text-[var(--text-faint)]">
                              {list.length}/{league.slots[r]} · {t.spentByRole[r]} cr
                            </span>
                          </div>
                          <Bar value={list.length} max={league.slots[r]} color={ROLE_COLOR[r]} />
                          <ul className="mt-2 space-y-1">
                            {list.map((entry) => {
                              const v = entry.valuation;
                              const delta = v ? entry.price - v.baseValue : 0;
                              return (
                                <Fragment key={entry.eventId}>
                                <li className="panel-flat flex items-center gap-2 px-2.5 py-1.5">
                                  <RoleBadge role={entry.player.role} size="sm" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium">
                                      {entry.player.name}
                                    </span>
                                    <span className="block truncate text-[0.62rem] text-[var(--text-faint)]">
                                      {entry.player.team}
                                      {consigli && v && ` · ${v.expFM.toFixed(2)} FM attesa`}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-right">
                                    <span className="num block text-xs font-bold">{entry.price}</span>
                                    {consigli && v && (
                                      <span
                                        className="num block text-[0.6rem]"
                                        style={{
                                          color:
                                            delta > 3
                                              ? "var(--danger)"
                                              : delta < -3
                                                ? "var(--accent)"
                                                : "var(--text-faint)",
                                        }}
                                      >
                                        {delta > 0 ? "+" : ""}
                                        {Math.round(delta)}
                                      </span>
                                    )}
                                  </span>
                                  {(isOwner || t.isMe) && (
                                    <button
                                      className="btn btn-sm"
                                      onClick={() =>
                                        setCorreggo(
                                          correggo === entry.eventId ? null : entry.eventId,
                                        )
                                      }
                                      title="Correggi prezzo o compratore"
                                    >
                                      {correggo === entry.eventId ? "✕" : "✎"}
                                    </button>
                                  )}
                                </li>
                                {correggo === entry.eventId && (
                                  <li>
                                    <Correzione
                                      eventId={entry.eventId}
                                      playerId={entry.player.id}
                                      playerName={entry.player.name}
                                      role={entry.player.role}
                                      prezzo={entry.price}
                                      partecipante={t.participant.id}
                                      onDone={() => setCorreggo(null)}
                                    />
                                  </li>
                                )}
                                </Fragment>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Rettificare un acquisto registrato male.
 *
 * All'asta si sbaglia a scrivere: un 130 al posto di 30, il compratore giusto
 * scelto nella riga sbagliata. Prima l'unico rimedio era cancellare e
 * ricominciare, e solo sulla propria rosa — mentre chi conduce l'asta e'
 * quello che vede l'errore per primo, spesso sulla rosa di un altro.
 *
 * La correzione passa dallo stesso controllo della registrazione: un prezzo
 * corretto non puo' lasciare una rosa che non si riesce a riempire, e spostare
 * un giocatore a un'altra squadra deve stare nei crediti di quella squadra,
 * non di quella da cui viene.
 */
function Correzione({
  eventId,
  playerId,
  playerName,
  role,
  prezzo,
  partecipante,
  onDone,
}: {
  eventId: string;
  playerId: string;
  playerName: string;
  role: Role;
  prezzo: number;
  partecipante: string;
  onDone: () => void;
}) {
  const { participants, state, recordEvent, deleteEvent } = useLeague();
  const [nuovoPrezzo, setNuovoPrezzo] = useState(String(prezzo));
  const [nuovoChi, setNuovoChi] = useState(partecipante);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const impossibile = perchePrezzoImpossibile({
    state,
    participantId: nuovoChi || null,
    price: Number(nuovoPrezzo) || 0,
    role,
    precedente: { participantId: partecipante, price: prezzo },
  });
  const cambiato = Number(nuovoPrezzo) !== prezzo || nuovoChi !== partecipante;

  return (
    <div className="panel-flat mt-1 px-2.5 py-2">
      <div className="label-xs mb-1.5">Correggi {playerName}</div>
      <div className="flex flex-wrap items-end gap-2">
        <div style={{ width: "5.5rem" }}>
          <label htmlFor={`p-${eventId}`}>Prezzo</label>
          <input
            id={`p-${eventId}`}
            type="number"
            min={0}
            className="num"
            value={nuovoPrezzo}
            onChange={(e) => setNuovoPrezzo(e.target.value)}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor={`c-${eventId}`}>A chi è andato</label>
          <select
            id={`c-${eventId}`}
            value={nuovoChi}
            onChange={(e) => setNuovoChi(e.target.value)}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className={impossibile || !cambiato ? "btn btn-sm" : "btn btn-sm btn-primary"}
          disabled={busy || !!impossibile || !cambiato}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const res = await recordEvent({
              playerId,
              participantId: nuovoChi,
              price: Number(nuovoPrezzo) || 0,
              outcome: "assigned",
            });
            setBusy(false);
            if (res.error) setErr(res.error);
            else onDone();
          }}
        >
          Salva
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await deleteEvent(eventId);
            setBusy(false);
            onDone();
          }}
          title="Cancella del tutto questo acquisto"
        >
          Elimina
        </button>
      </div>
      {impossibile && (
        <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--warn)]">{impossibile}</p>
      )}
      {err && <p className="mt-1.5 text-xs text-[var(--danger)]">{err}</p>}
    </div>
  );
}
