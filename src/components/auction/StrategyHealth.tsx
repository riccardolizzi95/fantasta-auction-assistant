"use client";

import { memo } from "react";

import { useLeague } from "@/components/LeagueDataProvider";
import { Aiuto, Bar } from "@/components/ui";
import { normalizeSplit } from "@/lib/fanta/strategies";
import { conConsigli } from "@/lib/livelli";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/fanta/types";

const ROLE_COLOR: Record<Role, string> = {
  P: "var(--role-p)",
  D: "var(--role-d)",
  C: "var(--role-c)",
  A: "var(--role-a)",
};

function StrategyHealth() {
  const { state, activeStrategy, me, league, livello } = useLeague();
  // Il base vede la cassa e la rosa — sono fatti — e nient'altro: nessuna
  // strategia, nessuna inflazione, nessun giudizio su come sta spendendo.
  const consigli = conConsigli(livello);

  if (!me || !state.me) {
    return (
      <div className="panel p-4 text-xs text-[var(--text-muted)]">
        Non sei un partecipante di questa lega: puoi seguire l&apos;asta ma non ricevere consigli
        personali.
      </div>
    );
  }

  const t = state.me;
  const split = activeStrategy
    ? normalizeSplit(activeStrategy.budget_split as Record<Role, number>)
    : null;

  return (
    <>
      {/* ------------------------------------------------- rosa in costruzione */}
      <div className="panel p-3.5">
        <div className="label-xs mb-2.5">La tua rosa</div>
        <div className="space-y-2.5">
          {ROLES.map((r) => {
            const done = t.bought[r];
            const total = league.slots[r];
            const plannedCredits = split ? Math.round(split[r] * t.participant.budget_total) : null;
            return (
              <div key={r}>
                <div className="flex items-baseline justify-between text-[0.7rem]">
                  <span className="font-medium" style={{ color: ROLE_COLOR[r] }}>
                    {ROLE_LABEL[r]}
                  </span>
                  <span className="num text-[var(--text-faint)]">
                    {done}/{total}
                  </span>
                </div>
                <div className="mt-1">
                  <Bar value={done} max={total} color={ROLE_COLOR[r]} />
                </div>
                {consigli && plannedCredits !== null && (
                  <div className="mt-0.5 flex justify-between text-[0.62rem] text-[var(--text-faint)]">
                    <span className="num">
                      spesi {t.spentByRole[r]} / {plannedCredits} previsti
                    </span>
                    {t.spentByRole[r] > plannedCredits && (
                      <span style={{ color: "var(--warn)" }}>fuori piano</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </>
  );
}

/**
 * Quanto si sta pagando sopra il valore, ruolo per ruolo.
 *
 * Sta in fondo alla colonna della lega e non in cima a quella della tua rosa:
 * e' un dato sul mercato, non su di te, e si guarda una volta ogni tanto — non
 * a ogni chiamata come i crediti o gli slot.
 */
export function InflazioneAsta() {
  const { state, livello } = useLeague();
  if (!conConsigli(livello)) return null;
  return (
    <div className="panel p-3.5">
      <div className="label-xs mb-2 flex items-center gap-1.5">
        Inflazione dell&apos;asta
        <Aiuto>
          {state.eventsAssigned < 6
            ? "Quanto si sta pagando sopra o sotto il valore calcolato, ruolo per ruolo. Servono più acquisti registrati perché il dato sia affidabile."
            : "Quanto si sta pagando sopra o sotto il valore calcolato, ruolo per ruolo."}
        </Aiuto>
      </div>
      <div className="space-y-1.5">
        {ROLES.map((r) => {
          const infl = state.inflationByRole[r];
          const pct = Math.round((infl - 1) * 100);
          return (
            <div key={r} className="flex items-baseline justify-between text-[0.7rem]">
              <span style={{ color: ROLE_COLOR[r] }}>{ROLE_LABEL[r]}</span>
              <span
                className="num font-semibold"
                style={{
                  color: pct > 6 ? "var(--danger)" : pct < -6 ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {pct > 0 ? "+" : ""}
                {pct}%
              </span>
            </div>
          );
        })}
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
export default memo(StrategyHealth);
