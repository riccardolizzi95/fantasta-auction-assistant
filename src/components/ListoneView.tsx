"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLeague } from "@/components/LeagueDataProvider";
import { conConsigli } from "@/lib/livelli";
import { RoleBadge } from "@/components/ui";
import MissingDataPanel from "@/components/MissingDataPanel";
import StatoFisicoPanel from "@/components/StatoFisicoPanel";
import { COMPETITION_OPTIONS } from "@/lib/fanta/competitions";
import { ROLES, ROLE_LABEL, ROLE_LABEL_SHORT, SEASON_WEIGHTS, type Role } from "@/lib/fanta/types";
import { deleteListone, deleteStatsSeason, type AdminActionState } from "@/app/actions";

type SortKey = "value" | "quotation" | "fm" | "apps" | "name";

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Le stagioni concluse pesano 100%, 55% e 30%; quella in corso parte quasi da
 * zero e cresce con le giornate.
 */
function pesoLabel(index: number, isCurrent: boolean): string {
  if (isCurrent) return "in corso";
  const w = SEASON_WEIGHTS[index];
  return w ? `peso ${Math.round(w * 100)}%` : "non usata";
}

const ROLE_COLOR: Record<Role, string> = {
  P: "var(--role-p)",
  D: "var(--role-d)",
  C: "var(--role-c)",
  A: "var(--role-a)",
};

export default function ListoneView({ isAdmin }: { isAdmin: boolean }) {
  const { loading, players, valuations, state, league, livello } = useLeague();
  // Senza consigli il listone resta un elenco: nome, squadra, quotazione
  // ufficiale e chi e' gia' andato. Il valore del modello, la fantamedia attesa
  // e la fascia sono giudizi, e spariscono.
  const consigli = conConsigli(livello);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "ALL">("ALL");
  const [onlyFree, setOnlyFree] = useState(true);
  const [sort, setSort] = useState<SortKey>("value");
  const ordina: SortKey = consigli ? sort : sort === "name" ? "name" : "quotation";

  const rows = useMemo(() => {
    const needle = strip(q.trim());
    let list = players.filter((p) => {
      if (role !== "ALL" && p.role !== role) return false;
      if (onlyFree && state.takenPlayerIds.has(p.id)) return false;
      if (!needle) return true;
      return strip(p.name).includes(needle) || strip(p.team).includes(needle);
    });
    list = list.slice().sort((a, b) => {
      const va = valuations.byPlayer.get(a.id);
      const vb = valuations.byPlayer.get(b.id);
      switch (ordina) {
        case "quotation":
          return (Number(b.quotation_current) || 0) - (Number(a.quotation_current) || 0);
        case "fm":
          return (vb?.expFM ?? 0) - (va?.expFM ?? 0);
        case "apps":
          return (vb?.expApps ?? 0) - (va?.expApps ?? 0);
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return (vb?.baseValue ?? 0) - (va?.baseValue ?? 0);
      }
    });
    return list.slice(0, 400);
  }, [players, q, role, onlyFree, ordina, valuations, state.takenPlayerIds]);

  // Per stagione: quante righe ci sono, e quante di quelle **non** vengono dai
  // file ufficiali. Le seconde costano quota e denaro a rifarle, quindi vanno
  // distinte da chi guarda il pulsante "cancella".
  const coverage = useMemo(() => {
    const counts = new Map<string, { tutte: number; recuperate: number }>();
    for (const p of players) {
      for (const h of p.history ?? []) {
        if (h.matches <= 0) continue;
        const c = counts.get(h.season) ?? { tutte: 0, recuperate: 0 };
        c.tutte += 1;
        if ((h.source ?? "import") !== "import") c.recuperate += 1;
        counts.set(h.season, c);
      }
    }
    return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [players]);

  const hasCurrent = coverage.some(([season]) => season === league.season);

  return (
    <div className="space-y-4">
      {players.length > 0 && (
        <DataPanel isAdmin={isAdmin} coverage={coverage} hasCurrent={hasCurrent} />
      )}

      {consigli && players.length > 0 && <BudgetSplitPanel />}

      {isAdmin ? <Uploader season={league.season} /> : null}

      <MissingDataPanel isAdmin={isAdmin} />

      {/* Solo per chi amministra: costa soldi veri e cancella quello che c'era
          prima. E va lanciata il giorno dell'asta, non prima. */}
      {isAdmin && <StatoFisicoPanel />}

      <div className="panel">
        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--border)] p-3">
          <div className="min-w-48 flex-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca giocatore o squadra"
            />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role | "ALL")}
            style={{ width: "7rem" }}
          >
            <option value="ALL">Tutti</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL_SHORT[r]}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{ width: "12rem" }}
          >
            {consigli && <option value="value">Ordina per valore</option>}
            <option value="quotation">Ordina per quotazione</option>
            {consigli && <option value="fm">Ordina per fantamedia attesa</option>}
            {consigli && <option value="apps">Ordina per presenze attese</option>}
            <option value="name">Ordina per nome</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[var(--text)]">
            <input
              type="checkbox"
              checked={onlyFree}
              onChange={(e) => setOnlyFree(e.target.checked)}
              className="accent-[var(--accent)]"
              style={{ width: "auto" }}
            />
            <span className="text-sm">Solo disponibili</span>
          </label>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-[var(--text-faint)]">Carico il listone…</p>
        ) : players.length === 0 ? (
          <p className="p-8 text-center text-sm text-[var(--text-faint)]">
            Nessun giocatore per la stagione {league.season}. Carica il file delle quotazioni.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[0.68rem] uppercase tracking-wide text-[var(--text-faint)]">
                  <th className="px-3 py-2 font-semibold">Giocatore</th>
                  <th className="px-2 py-2 font-semibold">Squadra</th>
                  <th className="px-2 py-2 text-right font-semibold">Qt.</th>
                  {consigli && (
                    <>
                      <th className="px-2 py-2 text-right font-semibold">Listino</th>
                      <th className="px-2 py-2 text-right font-semibold">Valore</th>
                      <th className="px-2 py-2 text-right font-semibold">FM attesa</th>
                      <th className="px-2 py-2 text-right font-semibold">Pres.</th>
                      <th className="px-3 py-2 font-semibold">Fascia</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((p) => {
                  const v = valuations.byPlayer.get(p.id);
                  const taken = state.takenPlayerIds.has(p.id);
                  const edge = v?.edgeVsMarket ?? 1;
                  return (
                    <tr key={p.id} className={taken ? "opacity-40" : ""}>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <RoleBadge role={p.role} size="sm" />
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-[var(--text-faint)]">{p.team}</td>
                      <td className="num px-2 py-1.5 text-right text-xs">{p.quotation_current ?? "—"}</td>
                      {consigli && (
                      <>
                      <td className="num px-2 py-1.5 text-right text-xs text-[var(--text-faint)]">
                        {Math.round(v?.marketPrice ?? 1)}
                      </td>
                      <td
                        className="num px-2 py-1.5 text-right font-bold"
                        style={{
                          color:
                            edge >= 1.2 ? "var(--accent)" : edge <= 0.8 ? "var(--danger)" : "var(--text)",
                        }}
                        title={
                          edge >= 1.2
                            ? "Il modello lo valuta più del listino: possibile affare"
                            : edge <= 0.8
                              ? "Il listino lo sopravvaluta rispetto al modello"
                              : undefined
                        }
                      >
                        {Math.round(v?.baseValue ?? 1)}
                      </td>
                      <td className="num px-2 py-1.5 text-right text-xs">{v?.expFM.toFixed(2)}</td>
                      <td className="num px-2 py-1.5 text-right text-xs">{Math.round(v?.expApps ?? 0)}</td>
                      <td className="px-3 py-1.5">
                        <span className="chip">{v?.tier}</span>
                      </td>
                      </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** La stagione dell'asta e poi a ritroso: 2026-27, 2025-26, 2024-25, ... */
function seasonOptions(season: string, howMany: number): string[] {
  const m = season.match(/^(\d{4})-(\d{2})$/);
  const start = m ? Number(m[1]) : new Date().getFullYear();
  return Array.from({ length: howMany }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

type UploadKind = "auto" | "quotazioni" | "statistiche";

/**
 * Cosa c'e' caricato e chi puo' toglierlo.
 *
 * Listone e statistiche sono dati globali: valgono per tutte le leghe, quindi
 * cancellarli e' un'operazione da amministratore. Il listone in particolare non
 * si tocca ad asta iniziata, perche' i giocatori sono referenziati dalle rose.
 */
function DataPanel({
  isAdmin,
  coverage,
  hasCurrent,
}: {
  isAdmin: boolean;
  coverage: [string, { tutte: number; recuperate: number }][];
  hasCurrent: boolean;
}) {
  const { players, league, events, reloadPlayers } = useLeague();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AdminActionState>(null);
  const astaIniziata = events.length > 0;

  /**
   * Dopo una cancellazione la pagina resta com'era: i dati del listone li tiene
   * il browser, non il server. Vanno ricaricati esplicitamente, altrimenti
   * sembra che il pulsante non abbia fatto niente.
   */
  const esegui = (
    fn: (prev: AdminActionState, fd: FormData) => Promise<AdminActionState>,
    fd: FormData,
  ) =>
    start(async () => {
      setMsg(null);
      const res = await fn(null, fd);
      setMsg(res);
      if (res?.ok) {
        await reloadPlayers();
        router.refresh();
      }
    });

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label-xs">Listone {league.season}</div>
          <div className="num text-lg font-bold">{players.length} giocatori</div>
          <p className="mt-1 max-w-xl text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
            Listone e statistiche sono dati condivisi: valgono per tutte le leghe, e solo un
            amministratore può cancellarli.
          </p>
        </div>
        {isAdmin && (
          <button
            className="btn btn-sm btn-danger"
            disabled={pending || astaIniziata}
            title={
              astaIniziata
                ? "L'asta è iniziata: il listone si aggiorna ricaricando il file, non si cancella"
                : "Cancella il listone e tutte le sue statistiche"
            }
            onClick={() => {
              const fd = new FormData();
              fd.set("season", league.season);
              esegui(deleteListone, fd);
            }}
          >
            {pending ? "Attendere…" : "Cancella listone"}
          </button>
        )}
      </div>

      {isAdmin && astaIniziata && (
        <p className="mt-2 text-[0.68rem] leading-relaxed text-[var(--warn)]">
          Ci sono {events.length} acquisti registrati: il listone non si cancella, si aggiorna
          ricaricando il file ufficiale. Chi non c&apos;è più viene disattivato, le rose restano
          intatte.
        </p>
      )}

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="label-xs mb-2">Statistiche caricate</div>
        {coverage.length === 0 ? (
          <p className="text-xs text-[var(--warn)]">
            Nessuna: senza statistiche i prezzi si basano solo sulle quotazioni.
          </p>
        ) : (
          <div className="space-y-1">
            {coverage.map(([season, conteggio], i) => {
              const n = conteggio.tutte;
              const isCurrent = season === league.season;
              const label = pesoLabel(isCurrent ? i : i - (hasCurrent ? 1 : 0), isCurrent);
              return (
                <div
                  key={season}
                  className="panel-flat flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5"
                >
                  <span className="num text-sm font-medium">{season}</span>
                  <span className="num text-xs text-[var(--text-faint)]">{n} giocatori</span>
                  {conteggio.recuperate > 0 && (
                    <span
                      className="chip"
                      style={{ color: "var(--info)" }}
                      title="Righe recuperate da archivio sportivo o modello. Rifarle costa quota e denaro, quindi la cancellazione non le tocca."
                    >
                      {conteggio.recuperate} recuperate
                    </span>
                  )}
                  <span
                    className="chip"
                    style={{ color: isCurrent ? "var(--warn)" : "var(--accent)" }}
                  >
                    {label}
                  </span>
                  <span className="flex-1" />
                  {isAdmin && (
                    <>
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={pending}
                        title="Toglie solo le righe che vengono dai file di Fantacalcio.it. Quelle recuperate restano."
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("season", season);
                          esegui(deleteStatsSeason, fd);
                        }}
                      >
                        Cancella i file ufficiali
                      </button>
                      {conteggio.recuperate > 0 && (
                        <button
                          className="btn btn-sm"
                          disabled={pending}
                          title="Cancella anche le righe recuperate da archivio e modello: per rifarle servono quota e denaro."
                          onClick={() => {
                            if (
                              !confirm(
                                `Cancellare anche le ${conteggio.recuperate} righe recuperate di ${season}?\n\n` +
                                  "Per rifarle servono la quota dell'archivio e una nuova spesa di modello.",
                              )
                            )
                              return;
                            const fd = new FormData();
                            fd.set("season", season);
                            fd.set("tutto", "si");
                            esegui(deleteStatsSeason, fd);
                          }}
                        >
                          Anche i recuperi
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {msg?.ok && <p className="mt-2 text-xs text-[var(--accent)]">{msg.ok}</p>}
        {msg?.error && <p className="mt-2 text-xs text-[var(--danger)]">{msg.error}</p>}
      </div>
    </div>
  );
}

/**
 * Dove vanno a finire i crediti della lega, reparto per reparto.
 *
 * E' la risposta alla domanda che viene naturale guardando il listone: perche'
 * quel difensore vale piu' di quell'attaccante? Quasi sempre e' il modificatore.
 */
function BudgetSplitPanel() {
  const { valuations, league } = useLeague();
  const totals = ROLES.map((r) => ({
    role: r,
    total: valuations.byRole[r].reduce((a, v) => a + v.baseValue, 0),
  }));
  const grand = totals.reduce((a, t) => a + t.total, 0) || 1;
  const mod = league.rules.defense_modifier;
  const modP = league.rules.goalkeeper_modifier;

  return (
    <div className="panel p-4">
      <div className="label-xs mb-2">Dove vanno i crediti, secondo il modello</div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {totals.map((t) => (
          <div
            key={t.role}
            style={{ width: `${(t.total / grand) * 100}%`, background: ROLE_COLOR[t.role] }}
            title={`${ROLE_LABEL[t.role]} ${((t.total / grand) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {totals.map((t) => (
          <span key={t.role} className="text-xs">
            <span style={{ color: ROLE_COLOR[t.role] }}>{ROLE_LABEL[t.role]}</span>{" "}
            <span className="num font-semibold">{((t.total / grand) * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
      {(mod || modP) && (
        <p className="mt-3 rounded-md border border-[var(--info)] bg-[color-mix(in_srgb,var(--info)_8%,transparent)] px-3 py-2 text-xs leading-relaxed">
          <strong style={{ color: "var(--info)" }}>
            Nella tua lega il modificatore {mod ? "di difesa" : "portiere"} è attivo
          </strong>
          , e sposta parecchi crediti verso {mod ? "difensori e portieri" : "i portieri"}. Un
          difensore da media voto alta vale punti ogni giornata, non solo quando segna: per questo
          può superare un attaccante. Il listino ufficiale non lo sa — è calcolato per leghe senza
          modificatore — quindi lì quei giocatori sembrano sempre sottovalutati. Se la tua lega non
          ha il modificatore, spegnilo nelle impostazioni: i prezzi cambiano subito.
        </p>
      )}
      <p className="mt-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        La colonna <strong className="text-[var(--text)]">Valore</strong> è quanto vale un giocatore
        <em> in più</em> del sostituto che troveresti gratis nel suo ruolo, moltiplicato per le
        partite che ci si aspetta giochi. Non è quanto rende in assoluto: un difensore con poca
        concorrenza può valere più di un attaccante che rende di più ma in un ruolo affollato.
      </p>
    </div>
  );
}

function Uploader({ season }: { season: string }) {
  const { reloadPlayers } = useLeague();
  const router = useRouter();
  const seasons = seasonOptions(season, 5);
  const [dragging, setDragging] = useState(false);
  const [kind, setKind] = useState<UploadKind>("auto");
  const [statsSeason, setStatsSeason] = useState(seasons[1] ?? seasons[0]);
  const [competition, setCompetition] = useState("serie-a");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("season", season);
    fd.append("kind", kind);
    fd.append("stats_season", statsSeason);
    fd.append("competition", competition);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import fallito");
      setResult(
        json.kind === "quotazioni"
          ? `Listone ${json.season} aggiornato: ${json.imported} giocatori.` +
            (json.deactivated
              ? ` ${json.deactivated} non sono più nel listone ufficiale e sono stati disattivati.`
              : "")
          : // La stagione la decide il nome del file, e quando non coincide con
            // quella scelta lo si dice per primo: e' il genere di svista che si
            // scopre due giorni dopo, guardando uno storico che non torna.
            (json.correttaDa
              ? `Il file dice ${json.season}: ho ignorato «${json.correttaDa}» che era selezionato. `
              : "") +
            `Statistiche ${json.season}: ${json.imported} giocatori aggiornati ` +
            `(${json.matchedBy.id} per Id, ${json.matchedBy.nameTeam} per nome e squadra, ${json.matchedBy.name} per solo nome)` +
            (json.unmatched
              ? `. ${json.unmatched} non presenti nel listone ${season}, ignorati: ${json.unmatchedSample.slice(0, 4).join(", ")}…`
              : ". Tutti abbinati."),
      );
      // Ricarichiamo i dati invece di ricaricare la pagina: e' immediato e non
      // fa perdere il messaggio di esito appena comparso.
      await reloadPlayers();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold">Carica i file ufficiali</h2>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
        Dall&apos;area download di Fantacalcio.it. Carica prima le{" "}
        <strong className="text-[var(--text)]">Quotazioni {season}</strong> (definiscono chi esiste),
        poi le <strong className="text-[var(--text)]">Statistiche</strong> di una o più stagioni
        passate: si agganciano ai giocatori già in listone.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="kind">Cosa stai caricando</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as UploadKind)}>
            <option value="auto">Riconoscilo dal contenuto</option>
            <option value="quotazioni">Quotazioni / listone</option>
            <option value="statistiche">Statistiche di una stagione</option>
          </select>
        </div>
        <div>
          <label htmlFor="stats_season">Stagione delle statistiche</label>
          <select
            id="stats_season"
            value={statsSeason}
            onChange={(e) => setStatsSeason(e.target.value)}
            disabled={kind === "quotazioni"}
          >
            {seasons.map((s, i) => (
              <option key={s} value={s}>
                {s}
                {i === 0
                  ? " — in corso, peso crescente"
                  : SEASON_WEIGHTS[i - 1]
                    ? ` — peso ${Math.round(SEASON_WEIGHTS[i - 1] * 100)}%`
                    : " — non usata"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="competition">Campionato</label>
          <select
            id="competition"
            value={competition}
            onChange={(e) => setCompetition(e.target.value)}
            disabled={kind === "quotazioni"}
          >
            {COMPETITION_OPTIONS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
                {c.production !== 1 ? ` — resa ${Math.round(c.production * 100)}%` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        Ogni stagione sta in un cassetto suo: caricare il 2024-25 non tocca il 2025-26. Ricaricare
        la stessa stagione la sovrascrive. Se il campionato è già iniziato puoi caricare anche{" "}
        <strong className="text-[var(--text)]">{seasons[0]}</strong>: con poche giornate conta
        pochissimo sulla fantamedia, ma dice subito chi sta giocando e chi no. Vale la pena
        ricaricarlo dopo ogni giornata.
      </p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          // Senza questi tre gestori il browser apre il file in una scheda nuova
          // invece di consegnarlo al campo.
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void upload(f);
        }}
        className="mt-3 flex cursor-pointer items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center normal-case tracking-normal transition-colors"
        style={{
          color: dragging ? "var(--accent)" : "var(--text-muted)",
          borderColor: dragging ? "var(--accent)" : "var(--border-strong)",
          background: dragging ? "color-mix(in srgb, var(--accent) 8%, transparent)" : undefined,
        }}
      >
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          style={{ display: "none" }}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <span className="text-sm">
          {busy
            ? "Importazione in corso…"
            : dragging
              ? "Lascia qui il file"
              : "Trascina qui il file .xlsx, oppure clicca per sceglierlo"}
        </span>
      </label>

      {result && (
        <p className="mt-3 rounded-md border border-[var(--accent-dim)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3 py-2 text-xs text-[var(--accent)]">
          {result}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-[#5a2a2c] bg-[#2a1618] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
