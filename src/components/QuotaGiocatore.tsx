"use client";

import { useActionState, useState } from "react";
import { setQuotaGiocatore, type AdminActionState } from "@/app/actions";
import { Fisarmonica, Interruttore } from "@/components/ui";

const SCELTE = [
  {
    quota: 1,
    nome: "Nessun tetto",
    detta: "Compra il più forte che il reparto si può permettere e riempie il resto al minimo.",
  },
  {
    quota: 0.24,
    nome: "Largo",
    detta: "Lascia spazio a un big vero, ma non a due.",
  },
  {
    quota: 0.14,
    nome: "Consigliato",
    detta: "Misurato come il migliore: più punti del nessun tetto, e una rosa senza buchi.",
  },
  {
    quota: 0.08,
    nome: "Stretto",
    detta: "Nessuna stella, undici titolari veri. Rischia di lasciare crediti in mano.",
  },
];

/**
 * Quanto puo' pesare un giocatore solo.
 *
 * Non e' una preferenza estetica: senza freno il piano metteva quasi tutta la
 * quota di un reparto sul primo nome, e sul listone vero veniva fuori una rosa
 * con dodici giocatori su venticinque a un credito — contro una mediana di 8
 * crediti nell'asta vera del 2025-26.
 *
 * La cosa interessante e' che il freno **fa anche piu' punti**, misurato su tre
 * strategie diverse: i punti li fa la formazione titolare, dove contano 3.6
 * difensori e 4.2 centrocampisti, e una stella sola non li riempie.
 */
export default function QuotaGiocatore({
  leagueId,
  participantId,
  budget,
  quota,
  attiva,
}: {
  leagueId: string;
  participantId: string;
  budget: number;
  /** `null` = lo decide il software. */
  quota: number | null;
  attiva: boolean;
}) {
  const [stato, azione, salvando] = useActionState<AdminActionState, FormData>(
    setQuotaGiocatore,
    null,
  );
  // Spento di default: chi non vuole pensarci non deve trovarsi un vincolo che
  // non ha scelto, e il software fa comunque la cosa misurata come migliore.
  const [acceso, setAcceso] = useState(quota != null);

  if (!attiva) {
    return (
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Scegli prima una strategia qui sopra: il tetto si applica a quella.
      </p>
    );
  }

  return (
    <form action={azione}>
      <input type="hidden" name="league_id" value={leagueId} />
      <input type="hidden" name="participant_id" value={participantId} />
      <input type="hidden" name="attivo" value={acceso ? "si" : "no"} />

      <Interruttore
        acceso={acceso}
        onChange={setAcceso}
        titolo="Decido io quanto può pesare uno"
        sotto={`Spento, il tetto lo sceglie il software: ${Math.round(0.14 * budget)} crediti, che è quello che le misure danno come migliore.`}
      />

      <Fisarmonica aperta={acceso}>
      <div className="grid gap-2 sm:grid-cols-2">
        {SCELTE.map((s) => {
          const scelta = quota != null && Math.abs(s.quota - quota) < 0.005;
          return (
            <label
              key={s.quota}
              className="panel-flat flex cursor-pointer items-start gap-2.5 px-3 py-2.5"
              style={
                scelta
                  ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 7%, transparent)" }
                  : undefined
              }
            >
              <input
                type="radio"
                name="quota"
                value={s.quota}
                defaultChecked={scelta}
                disabled={!acceso}
                className="mt-0.5 accent-[var(--accent)]"
                style={{ width: "auto" }}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold">{s.nome}</span>
                  <span className="num text-[0.68rem] text-[var(--text-faint)]">
                    {s.quota >= 1 ? "tutto il budget" : `max ${Math.round(s.quota * budget)} crediti`}
                  </span>
                </span>
                <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-[var(--text-muted)]">
                  {s.detta}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      </Fisarmonica>

      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-primary" disabled={salvando}>
          {salvando ? "Salvo…" : "Salva"}
        </button>
        {stato?.error && <span className="text-xs text-[var(--danger)]">{stato.error}</span>}
        {stato?.ok && <span className="text-xs text-[var(--accent)]">{stato.ok}</span>}
      </div>

      <div className="mt-4 overflow-x-auto border-t border-[var(--border)] pt-3">
        <p className="mb-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
          Misurato sul listone vero, a inizio asta, con 500 crediti. La mediana dice quanto costa il
          giocatore di mezzo della rosa: l&apos;asta vera del 2025-26 aveva mediana 8.
        </p>
        <table className="w-full text-[0.68rem]">
          <thead className="text-[var(--text-faint)]">
            <tr>
              <th className="py-1 text-left font-semibold">tetto</th>
              <th className="py-1 text-right font-semibold">punti/giornata</th>
              <th className="py-1 text-right font-semibold">il più caro</th>
              <th className="py-1 text-right font-semibold">mediana</th>
              <th className="py-1 text-right font-semibold">a 1 credito</th>
            </tr>
          </thead>
          <tbody className="num">
            {[
              ["nessuno", "72.33", "182", "2", "12/25"],
              ["120 cr", "72.39", "111", "4", "11/25"],
              ["70 cr", "72.83", "65", "4", "9/25"],
              ["50 cr", "72.82", "49", "22", "7/25"],
            ].map((r) => (
              <tr key={r[0]} className="border-t border-[var(--border)]">
                <td className="py-1">{r[0]}</td>
                <td className="py-1 text-right">{r[1]}</td>
                <td className="py-1 text-right">{r[2]}</td>
                <td className="py-1 text-right">{r[3]}</td>
                <td className="py-1 text-right">{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
