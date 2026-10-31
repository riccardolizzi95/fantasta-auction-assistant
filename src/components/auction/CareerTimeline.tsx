"use client";

import { competitionByKey, SERIE_A_KEY } from "@/lib/fanta/competitions";
import { ROLE_BASELINE_FM, type PlayerWithStats } from "@/lib/fanta/types";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  campionato: { label: "", color: "var(--accent)" },
  prestito: { label: "in prestito", color: "var(--info)" },
  giovanili: { label: "giovanili", color: "var(--text-faint)" },
  infortunio: { label: "infortunio", color: "var(--danger)" },
  "fuori-rosa": { label: "fuori rosa", color: "var(--warn)" },
  "non-professionista": { label: "non ancora professionista", color: "var(--text-faint)" },
  sconosciuta: { label: "stagione non ricostruita", color: "var(--text-faint)" },
};

/**
 * La carriera messa in fila, con i numeri dove ci sono.
 *
 * Serve a leggere in un colpo d'occhio due cose che i numeri da soli non dicono:
 * da dove viene un giocatore, e se le stagioni senza dati sono buchi
 * nell'informazione o annate che non ci sono proprio state — un ventenne al
 * secondo anno da professionista non ha dati mancanti, non giocava ancora.
 */
export default function CareerTimeline({ player }: { player: PlayerWithStats }) {
  const career = player.career ?? [];
  const identity = player.identity;
  if (career.length === 0 && !identity?.debut_season) return null;

  const statsBySeason = new Map(
    (player.history ?? []).filter((h) => h.matches > 0).map((h) => [h.season, h]),
  );

  // Una scala comune a tutte le barre, altrimenti il confronto fra stagioni
  // ingannerebbe l'occhio.
  const fms = [...statsBySeason.values()]
    .map((h) => Number(h.avg_fantavote ?? 0))
    .filter((v) => v > 0);
  const min = Math.min(ROLE_BASELINE_FM[player.role] - 0.8, ...(fms.length ? fms : [5]));
  const max = Math.max(ROLE_BASELINE_FM[player.role] + 1.2, ...(fms.length ? fms : [7]));
  const span = max - min || 1;

  const seasons = career.length
    ? career
    : (player.history ?? []).map((h) => ({
        season: h.season,
        club: null,
        competition: h.competition ?? SERIE_A_KEY,
        country: null,
        status: "campionato" as const,
        is_debut: false,
        note: null,
        confidence: null,
        player_id: player.id,
      }));

  return (
    <div className="panel-flat p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="label-xs">Carriera</span>
        {identity?.full_name && (
          <span className="text-[0.68rem] text-[var(--text-faint)]">
            {identity.full_name}
            {identity.birth_year ? `, ${identity.birth_year}` : ""}
            {identity.nationality ? ` · ${identity.nationality}` : ""}
          </span>
        )}
      </div>

      <div className="space-y-1">
        {seasons.map((c) => {
          const stat = statsBySeason.get(c.season);
          const fm = stat?.avg_fantavote != null ? Number(stat.avg_fantavote) : null;
          const comp = competitionByKey(c.competition ?? SERIE_A_KEY);
          const stato = STATUS_LABEL[c.status] ?? STATUS_LABEL.sconosciuta;
          const pct = fm != null ? Math.max(2, ((fm - min) / span) * 100) : 0;
          const isSerieA = comp.key === SERIE_A_KEY;

          return (
            <div key={`${c.season}-${c.club ?? ""}`} className="flex items-center gap-2 text-[0.68rem]">
              <span className="num w-14 shrink-0 text-[var(--text-faint)]">{c.season}</span>
              <span className="w-32 shrink-0 truncate" title={c.club ?? ""}>
                {c.club ?? "—"}
              </span>
              <span
                className="w-28 shrink-0 truncate"
                style={{ color: isSerieA ? "var(--text-muted)" : "var(--info)" }}
                title={
                  isSerieA
                    ? "Serie A"
                    : `${comp.label}: gol e assist convertiti al ${Math.round(comp.production * 100)}% della resa in Serie A`
                }
              >
                {comp.label}
              </span>
              <span className="flex h-3 flex-1 items-center">
                {fm != null ? (
                  <span
                    className="h-2 rounded-sm"
                    style={{
                      width: `${pct}%`,
                      background: isSerieA ? "var(--accent)" : "var(--info)",
                      opacity: 0.85,
                    }}
                  />
                ) : (
                  <span className="text-[var(--text-faint)]" style={{ color: stato.color }}>
                    {stato.label || "nessun dato"}
                  </span>
                )}
              </span>
              <span className="num w-10 shrink-0 text-right">
                {fm != null ? fm.toFixed(2) : ""}
              </span>
              <span className="num w-16 shrink-0 text-right text-[var(--text-faint)]">
                {stat ? `${stat.matches}p ${stat.goals}g` : ""}
              </span>
              {c.is_debut && (
                <span className="chip shrink-0" style={{ color: "var(--warn)" }} title="Prima stagione da professionista">
                  debutto
                </span>
              )}
            </div>
          );
        })}
      </div>

      {identity?.debut_season && (
        <p className="mt-2 text-[0.65rem] leading-relaxed text-[var(--text-faint)]">
          Debutto fra i professionisti nel {identity.debut_season}
          {identity.debut_club ? ` al ${identity.debut_club}` : ""}.
          {identity.note ? ` ${identity.note}` : ""}
          {identity.confidence ? ` (fiducia ${identity.confidence})` : ""}
        </p>
      )}
    </div>
  );
}
