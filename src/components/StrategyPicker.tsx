"use client";

import { useActionState, useState } from "react";
import { setStrategy, type AdminActionState } from "@/app/actions";
import { availableStrategies, normalizeSplit } from "@/lib/fanta/strategies";
import { ROLES, ROLE_LABEL, type LeagueRules, type Role } from "@/lib/fanta/types";

const ROLE_COLOR: Record<Role, string> = {
  P: "var(--role-p)",
  D: "var(--role-d)",
  C: "var(--role-c)",
  A: "var(--role-a)",
};

export default function StrategyPicker({
  leagueId,
  participantId,
  budget,
  rules,
  activeKey,
  activeSplit,
}: {
  leagueId: string;
  participantId: string;
  budget: number;
  rules: LeagueRules;
  activeKey: string | null;
  activeSplit: Record<string, number> | null;
}) {
  const [stato, azione, salvando] = useActionState<AdminActionState, FormData>(setStrategy, null);
  const options = availableStrategies(rules);
  const [selected, setSelected] = useState(activeKey ?? options[0]?.key ?? "equilibrata");
  const def = options.find((o) => o.key === selected) ?? options[0];

  const baseSplit =
    activeKey === selected && activeSplit
      ? normalizeSplit(activeSplit as Record<Role, number>)
      : def.budgetSplit;

  const [split, setSplit] = useState<Record<Role, number>>({
    P: Math.round(baseSplit.P * 100),
    D: Math.round(baseSplit.D * 100),
    C: Math.round(baseSplit.C * 100),
    A: Math.round(baseSplit.A * 100),
  });
  const [tuned, setTuned] = useState(false);

  function pick(key: string) {
    setSelected(key);
    const d = options.find((o) => o.key === key);
    if (d) {
      setSplit({
        P: Math.round(d.budgetSplit.P * 100),
        D: Math.round(d.budgetSplit.D * 100),
        C: Math.round(d.budgetSplit.C * 100),
        A: Math.round(d.budgetSplit.A * 100),
      });
      setTuned(false);
    }
  }

  const total = ROLES.reduce((a, r) => a + split[r], 0);

  return (
    <form action={azione} className="space-y-4">
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="participant_id" value={participantId} />
      <input type="hidden" name="strategy_key" value={selected} />

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const isActive = o.key === selected;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => pick(o.key)}
              className={`rounded-xl border p-3 text-left transition-all ${
                isActive
                  ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                  : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{o.label}</span>
                <span className="chip" title="Rischio">
                  {"▮".repeat(o.risk)}
                  <span className="text-[var(--text-faint)]">{"▯".repeat(5 - o.risk)}</span>
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">{o.summary}</p>
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full">
                {ROLES.map((r) => (
                  <div
                    key={r}
                    style={{ width: `${o.budgetSplit[r] * 100}%`, background: ROLE_COLOR[r] }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {def && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="panel-flat p-3">
            <div className="label-xs mb-2">Perché funziona</div>
            <ul className="space-y-1">
              {def.pros.map((p) => (
                <li key={p} className="flex gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
                  <span style={{ color: "var(--accent)" }}>+</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="panel-flat p-3">
            <div className="label-xs mb-2">Dove ti espone</div>
            <ul className="space-y-1">
              {def.cons.map((p) => (
                <li key={p} className="flex gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
                  <span style={{ color: "var(--danger)" }}>−</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="panel-flat p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="label-xs">Ripartizione del budget</div>
          <span className={`num text-xs ${total === 100 ? "text-[var(--text-faint)]" : "text-[var(--warn)]"}`}>
            {total}% {total !== 100 && "(verrà normalizzato)"}
          </span>
        </div>
        <div className="space-y-2.5">
          {ROLES.map((r) => (
            <div key={r} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs font-medium" style={{ color: ROLE_COLOR[r] }}>
                {ROLE_LABEL[r]}
              </span>
              <input
                type="range"
                min={0}
                max={70}
                value={split[r]}
                onChange={(e) => {
                  setSplit({ ...split, [r]: Number(e.target.value) });
                  setTuned(true);
                }}
                className="flex-1 accent-[var(--accent)]"
                style={{ padding: 0, border: "none", background: "transparent" }}
              />
              <span className="num w-10 shrink-0 text-right text-xs">{split[r]}%</span>
              <span className="num w-16 shrink-0 text-right text-xs text-[var(--text-faint)]">
                {Math.round((split[r] / 100) * budget)} cr
              </span>
              {tuned && <input type="hidden" name={`split_${r}`} value={split[r]} />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={salvando}>
          {salvando ? "Salvo…" : "Salva strategia"}
        </button>
        {/* Senza una parola dopo il salvataggio non si sa se ha funzionato, e
            si preme due volte. */}
        {stato?.ok && (
          <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>
            ✓ {stato.ok}
          </span>
        )}
        {stato?.error && <span className="text-xs text-[var(--danger)]">{stato.error}</span>}
      </div>
    </form>
  );
}
