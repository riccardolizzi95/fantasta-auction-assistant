"use client";

import { useLeague } from "@/components/LeagueDataProvider";

/**
 * I crediti residui, nell'intestazione.
 *
 * Erano un pannello intero in cima alla colonna di sinistra. Ma in un'asta lo
 * spazio verticale e' la risorsa scarsa — la rosa e il piano vogliono tutto
 * quello che c'e' — e questi sono tre numeri che devono solo restare sempre
 * visibili, non occupare un riquadro.
 */
export default function CreditiInNav() {
  const { state } = useLeague();
  const me = state.me;
  if (!me) return null;

  const quota = me.participant.budget_total > 0 ? me.remaining / me.participant.budget_total : 0;
  const colore = quota < 0.12 ? "var(--danger)" : quota < 0.3 ? "var(--warn)" : "var(--accent)";

  return (
    <div
      className="hidden shrink-0 items-baseline gap-3 rounded-lg border border-[var(--border)] px-2.5 py-1 md:flex"
      title="Crediti residui · massimo che puoi offrire ora · slot da riempire"
    >
      <span className="flex items-baseline gap-1">
        <span className="num text-sm font-bold leading-none" style={{ color: colore }}>
          {me.remaining}
        </span>
        <span className="text-[0.6rem] text-[var(--text-faint)]">
          /{me.participant.budget_total}
        </span>
      </span>
      <span className="flex items-baseline gap-1 border-l border-[var(--border)] pl-3">
        <span className="text-[0.6rem] uppercase tracking-wide text-[var(--text-faint)]">max</span>
        <span className="num text-xs font-semibold">{me.maxBid}</span>
      </span>
      <span className="flex items-baseline gap-1 border-l border-[var(--border)] pl-3">
        <span className="num text-xs font-semibold">{me.totalSlotsLeft}</span>
        <span className="text-[0.6rem] text-[var(--text-faint)]">da prendere</span>
      </span>
    </div>
  );
}
