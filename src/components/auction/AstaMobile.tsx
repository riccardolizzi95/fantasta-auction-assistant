"use client";

import { memo, useMemo } from "react";
import { useLeague } from "@/components/LeagueDataProvider";
import AscoltoAsta from "@/components/auction/AscoltoAsta";
import ChiamataInCorso from "@/components/auction/ChiamataInCorso";
import { recommend, VERDICT_LABEL } from "@/lib/fanta/recommend";
import { ROLES, ROLE_LABEL_SHORT } from "@/lib/fanta/types";
import { conConsigli } from "@/lib/livelli";

/**
 * L'asta in mano, non alla scrivania.
 *
 * Sul telefono ci sono tre cose e basta: **quanto ti resta**, **cosa stanno
 * chiamando adesso** e **fin dove puoi spingerti**. Tutto il resto — il
 * listone, la ricerca, la rosa ideale, lo storico — alla scrivania serve, qui
 * ruba lo schermo alle uniche tre cose che non puoi rimandare, e per giunta
 * mentre stai in piedi con una mano sola.
 *
 * Non c'e' nemmeno un modulo per registrare: prezzo e acquirente sono gia'
 * sulla barra della chiamata, e aggiudicare e' un tasto li' dentro.
 */
function AstaMobile() {
  const { players, giocatoriInAsta, state, valuations, activeStrategy, livello, league } = useLeague();
  const consigli = conConsigli(livello);
  const me = state.me;

  const player = league.current_player_id
    ? (players.find((p) => p.id === league.current_player_id) ?? null)
    : null;

  // Il consiglio ridotto all'osso: tre numeri e un verdetto.
  const rec = useMemo(
    () =>
      player && consigli
        ? recommend({
            player,
            state,
            valuations,
            allPlayers: giocatoriInAsta,
            strategyKey: activeStrategy?.key ?? "equilibrata",
            budgetSplit: activeStrategy?.budget_split as never,
          })
        : null,
    [player, consigli, state, valuations, giocatoriInAsta, activeStrategy],
  );

  return (
    <div className="space-y-3">
      {/* ---------------------------------------- quanto ti resta, sempre in cima */}
      <div className="panel p-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="label-xs">I tuoi crediti</div>
            <div className="num text-3xl font-bold leading-none" style={{ color: "var(--accent)" }}>
              {me?.remaining ?? "—"}
            </div>
          </div>
          <div className="text-right text-[0.68rem] leading-tight text-[var(--text-faint)]">
            {me ? (
              <>
                <div>
                  max offerta <span className="num text-[var(--text-muted)]">{me.maxBid}</span>
                </div>
                <div>
                  <span className="num text-[var(--text-muted)]">{me.totalSlotsLeft}</span> slot da
                  riempire
                </div>
              </>
            ) : (
              "non sei un partecipante"
            )}
          </div>
        </div>
        {me && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <span
                key={r}
                className="chip"
                style={{ color: me.slotsLeft[r] === 0 ? "var(--text-faint)" : "var(--info)" }}
              >
                {ROLE_LABEL_SHORT[r]} {me.bought[r]}/{me.bought[r] + me.slotsLeft[r]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------- cosa stanno chiamando adesso */}
      <ChiamataInCorso />

      {/* ---------------------------------------- fin dove puoi spingerti */}
      {player && rec && (
        <div className="panel p-3">
          <div className="label-xs" style={{ color: "var(--accent)" }}>
            {VERDICT_LABEL[rec.verdict]}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["apri a", rec.target, "var(--text-muted)"],
                ["prezzo giusto", rec.fair, "var(--accent)"],
                ["non superare", rec.max, "var(--danger)"],
              ] as const
            ).map(([l, v, c]) => (
              <div key={l}>
                <div className="text-[0.58rem] uppercase tracking-wide text-[var(--text-faint)]">
                  {l}
                </div>
                <div className="num text-2xl font-bold leading-tight" style={{ color: c }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.72rem] leading-relaxed text-[var(--text-muted)]">
            {rec.headline}
          </p>
        </div>
      )}

      {/* Senza premium restano i fatti: chi e', dove gioca, quanto lo prezza il
          listino. Nessun numero calcolato, come dappertutto. */}
      {player && !consigli && (
        <div className="panel p-3 text-xs text-[var(--text-muted)]">
          {player.name} · {player.team} · {ROLE_LABEL_SHORT[player.role]}
          {player.quotation_current != null && (
            <>
              {" · "}
              quotazione <span className="num">{player.quotation_current}</span>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------- l'orecchio in mezzo al tavolo
          Il telefono e' quasi sempre il dispositivo piu' vicino al banditore:
          acceso qui, quello che sente arriva a chi conduce. */}
      <AscoltoAsta />
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
export default memo(AstaMobile);
