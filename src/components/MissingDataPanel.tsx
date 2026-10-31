"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLeague } from "@/components/LeagueDataProvider";
import { Bar, RoleBadge } from "@/components/ui";
import { saveManualStats, type AdminActionState } from "@/app/actions";
import { COMPETITION_OPTIONS } from "@/lib/fanta/competitions";
import { recoveryProgress, toRecover } from "@/lib/fanta/recovery";
import type { PlayerWithStats } from "@/lib/fanta/types";

type Outcome = {
  playerId: string;
  name: string;
  status: "ok" | "identificato" | "non-trovato" | "errore" | "rimandato";
  via?: "api" | "ai" | null;
  resolvedName?: string | null;
  confidence?: string | null;
  note?: string | null;
  seasons?: { season: string; competition: string; matches: number; goals: number }[];
  message?: string;
};

const STATUS_LABEL: Record<Outcome["status"], string> = {
  ok: "trovato",
  identificato: "identificato, niente numeri",
  "non-trovato": "non trovato",
  errore: "errore",
  rimandato: "rimandato",
};

/**
 * Costo per giocatore in coda, misurato su una corsa intera.
 *
 * Non e' il costo di una chiamata ma quello di un giocatore portato a casa, ed
 * e' piu' alto perche' comprende i ritentativi: 126 giocatori in coda sono
 * costati 196 chiamate — chi non si trova al primo giro viene ricercato una
 * seconda volta — per $1.498 totali. Stimare sul costo della singola chiamata
 * ($0.0075) sbagliava del 35% per difetto, che e' il verso peggiore quando il
 * numero serve a decidere se spendere.
 */
const COSTO_CON_WEB = 0.0119;
const COSTO_SENZA_WEB = 0.003;

/** Quanti giocatori per lotto. Deve combaciare con LOTTO_DEFAULT nella route. */
const LOTTO = 20;

/**
 * Freno di sicurezza del ciclo: con lotti da venti, i 533 del listone stanno in
 * ventisette giri. Oltre il doppio significa che qualcosa non avanza, e un ciclo
 * che non avanza va fermato da solo invece di spendere finche' qualcuno guarda.
 */
const MAX_LOTTI = 60;

type Avanzamento = {
  fatti: number;
  totale: number;
  lotti: number;
  costo: number;
  rinunciati: number;
  stopped: string | null;
};

export default function MissingDataPanel({ isAdmin }: { isAdmin: boolean }) {
  const { players, league, reloadPlayers } = useLeague();
  const [busy, setBusy] = useState<null | "auto" | "ai">(null);
  const [avanzamento, setAvanzamento] = useState<Avanzamento | null>(null);
  const [conferma, setConferma] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [aiWeb, setAiWeb] = useState(true);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  // Il ciclo gira dentro una funzione async: leggerebbe la chiusura di quando e'
  // partito, e uno stato React non lo fermerebbe mai. Un ref lo ferma.
  const fermare = useRef(false);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsage(await res.json());
    } catch {
      // Il consumo e' un di piu': se non arriva, il resto funziona lo stesso.
    }
  }, []);

  // Il consumo si legge all'apertura e dopo ogni operazione. Lo stato si aggiorna
  // dentro la promise, non nel corpo dell'effetto: qui stiamo sottoscrivendo una
  // fonte esterna, non sincronizzando stato React con altro stato React.
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (alive && json) setUsage(json);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  // Un conteggio solo, calcolato dove lo calcola anche il server: prima il
  // numero grande diceva "ancora al buio" e il testo accanto ne diceva un altro,
  // e con un pulsante che li lavora tutti due numeri diversi non si spiegano.
  const progresso = useMemo(
    () => recoveryProgress(players, league.season),
    [players, league.season],
  );
  const coda = useMemo(() => toRecover(players, league.season), [players, league.season]);

  const stimaCosto = coda.length * (aiWeb ? COSTO_CON_WEB : COSTO_SENZA_WEB);

  /**
   * Il ciclo: un lotto per volta, finche' non finiscono o non lo si ferma.
   *
   * Sta nel browser e non in un cron per una ragione precisa: qui il lavoro passa
   * dallo stesso endpoint che usa il resto dell'applicazione, con la stessa
   * sessione e le stesse policy. Ogni lotto scrive sul database prima di
   * rispondere, quindi chiudere la scheda perde il lotto in corso e non il
   * lavoro; e il giorno dopo si riprende da dove si era arrivati perche' e' il
   * server a scegliersi chi manca, non il browser a tenere il segno.
   */
  async function run(source: "auto" | "ai") {
    fermare.current = false;
    setBusy(source);
    setError(null);
    setNotice(null);
    setConferma(false);
    setOutcomes([]);
    let stato: Avanzamento = {
      fatti: 0,
      totale: coda.length,
      lotti: 0,
      costo: 0,
      rinunciati: 0,
      stopped: null,
    };
    setAvanzamento(stato);
    // Un lotto che non interroga nessuno non e' un lotto lento, e' un lotto che
    // non puo' funzionare: chiave mancante, credito finito, fornitore giu'. Due
    // di fila e il ciclo si ferma da solo dicendo perche', invece di macinare
    // sessanta giri a vuoto come ha fatto la prima volta che l'ho provato senza
    // chiavi.
    let aVuoto = 0;
    try {
      while (!fermare.current && stato.lotti < MAX_LOTTI) {
        const res = await fetch("/api/external-stats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ take: LOTTO, source, web: aiWeb }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Richiesta fallita");

        stato = {
          fatti: Math.max(0, stato.totale - Number(json.remaining ?? 0)),
          totale: stato.totale,
          lotti: stato.lotti + 1,
          costo: stato.costo + Number(json.cost ?? 0),
          rinunciati: Number(json.givenUp ?? 0),
          stopped: json.stopped ?? stato.stopped,
        };
        setAvanzamento(stato);
        // I risultati si accumulano, i piu' recenti in cima: durante un ciclo di
        // otto lotti si vuole vedere cosa sta succedendo adesso.
        setOutcomes((prima) => [...(json.outcomes ?? []), ...prima].slice(0, 300));
        for (const a of json.avvisi ?? []) console.warn("[recupero]", a);

        if (json.done) break;
        // Un lotto che non lavora nessuno e non si dichiara finito girerebbe a
        // vuoto per sempre: meglio fermarsi e dirlo.
        if (!json.processed) {
          stato = { ...stato, stopped: stato.stopped ?? "Nessun giocatore lavorabile." };
          setAvanzamento(stato);
          break;
        }
        aVuoto = json.attempted ? 0 : aVuoto + 1;
        if (aVuoto >= 2) {
          stato = {
            ...stato,
            stopped:
              (json.avvisi ?? [])[0] ??
              "Due lotti di fila senza che nessuna fonte rispondesse: controlla le chiavi e il credito.",
          };
          setAvanzamento(stato);
          break;
        }
      }
      setNotice(
        (fermare.current ? "Fermato. " : "Finito. ") +
          `${stato.fatti} di ${stato.totale} recuperati in ${stato.lotti} lotti` +
          (stato.costo ? `, costo $${stato.costo.toFixed(3)}` : "") +
          (stato.rinunciati
            ? `. Su ${stato.rinunciati} nessuna fonte ha trovato niente: restano da inserire a mano.`
            : ".") +
          (stato.stopped ? ` ${stato.stopped}` : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      void loadUsage();
      await reloadPlayers();
    }
  }

  async function testApi() {
    setApiStatus("Verifico…");
    try {
      const res = await fetch("/api/external-stats");
      const json = await res.json();
      void loadUsage();
      setApiStatus(
        json.configured
          ? `${json.ok ? "✓" : "✗"} ${json.message}` +
            (json.seasonLabels?.length
              ? ` Stagioni coperte dal piano: ${json.seasonLabels.join(", ")}.`
              : "")
          : json.message,
      );
    } catch (e) {
      setApiStatus((e as Error).message);
    }
  }

  if (players.length === 0) return null;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Giocatori senza storico di Serie A</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
            Sono {progresso.daRecuperare}: neopromossi, giovani e soprattutto chi arriva
            dall&apos;estero o dalla Serie B. Senza dati il motore può stimarli solo dalla
            quotazione, cioè copiando il mercato — proprio dove il mercato sbaglia di più.
            Recuperando le statistiche del campionato in cui giocavano, la produzione viene
            convertita alla scala della Serie A.
          </p>
        </div>
        <div className="text-right">
          <div className="num text-2xl font-bold">
            <span style={{ color: "var(--accent)" }}>{progresso.recuperati}</span>
            <span className="text-base font-normal text-[var(--text-faint)]">
              /{progresso.daRecuperare}
            </span>
          </div>
          <div className="label-xs">recuperati</div>
        </div>
      </div>

      <div className="mt-3">
        <Bar
          value={progresso.recuperati}
          max={Math.max(1, progresso.daRecuperare)}
          color="var(--accent)"
        />
        <p className="mt-1 text-[0.68rem] text-[var(--text-faint)]">
          {progresso.alBuio > 0
            ? `${progresso.alBuio} ancora al buio: il motore può solo copiarne la quotazione.`
            : "Tutti coperti da almeno una fonte."}
        </p>
      </div>

      {isAdmin && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {busy ? (
            <button
              className="btn btn-sm"
              onClick={() => {
                fermare.current = true;
              }}
            >
              Ferma
            </button>
          ) : conferma ? (
            <button className="btn btn-sm btn-primary" onClick={() => run("auto")}>
              Conferma: {coda.length} giocatori, circa ${stimaCosto.toFixed(2)}
            </button>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={coda.length === 0}
              onClick={() => setConferma(true)}
            >
              {coda.length === 0 ? "Non resta nessuno" : "Recupera tutti"}
            </button>
          )}
          <button
            className="btn btn-sm"
            disabled={!!busy || coda.length === 0}
            onClick={() => run("ai")}
          >
            {busy === "ai" ? "Cerco…" : "Solo AI"}
          </button>
          <label
            className="flex cursor-pointer items-center gap-1.5 normal-case tracking-normal text-[var(--text-muted)]"
            title="La ricerca web è la voce di spesa più cara: OpenRouter la fattura a risultato. Senza, il modello usa solo quello che sa."
          >
            <input
              type="checkbox"
              checked={aiWeb}
              onChange={(e) => setAiWeb(e.target.checked)}
              className="accent-[var(--accent)]"
              style={{ width: "auto" }}
            />
            <span className="text-xs">con ricerca web</span>
          </label>
          <button className="btn btn-sm" onClick={testApi}>
            Prova la chiave
          </button>
          {apiStatus && <span className="text-xs text-[var(--text-faint)]">{apiStatus}</span>}
        </div>
      )}

      {avanzamento && (
        <div className="mt-3 rounded-md border border-[var(--border-strong)] px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label-xs">{busy ? "Recupero in corso" : "Ultimo recupero"}</span>
            <span className="num text-xs">
              lotto {avanzamento.lotti} · ${avanzamento.costo.toFixed(3)}
            </span>
          </div>
          <div className="mt-1.5">
            <Bar
              value={avanzamento.fatti}
              max={Math.max(1, avanzamento.totale)}
              color="var(--info)"
            />
          </div>
          <div className="mt-1 text-[0.68rem] text-[var(--text-faint)]">
            {avanzamento.fatti} di {avanzamento.totale}
            {avanzamento.rinunciati > 0 && ` · ${avanzamento.rinunciati} senza fonti`}
            {avanzamento.stopped && ` · ${avanzamento.stopped}`}
            {busy && " · la scheda deve restare aperta, ma ogni lotto è già salvato"}
          </div>
        </div>
      )}

      {isAdmin && usage && <UsageBar usage={usage} />}

      {isAdmin && (
        <p className="mt-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
          Il pulsante lavora a lotti da {LOTTO}, dal più quotato al meno quotato, e ogni lotto è
          salvato prima del successivo: se chiudi la scheda perdi il lotto in corso, non il lavoro.
          Dentro ogni lotto l&apos;AI capisce chi è (il listone lo chiama &quot;Ramos G.&quot;, e la
          squadra dice quale Ramos), poi i due canali corrono insieme — API-Football sui più quotati
          finché la quota lo consente, l&apos;AI su tutti gli altri. Chiave gratuita su{" "}
          <a
            href="https://dashboard.api-football.com/register"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-[var(--text-muted)]"
          >
            dashboard.api-football.com
          </a>
          : 100 chiamate al giorno azzerate a mezzanotte UTC e 10 al minuto, cioè una trentina di
          giocatori al giorno. L&apos;AI non ha quel limite ma è meno affidabile, e infatti il motore
          pesa quei dati il 35% in meno: per questo una corsa sola copre tutti con l&apos;AI, e
          l&apos;archivio poi rimpiazza i più quotati giorno per giorno.
        </p>
      )}

      {notice && (
        <p className="mt-3 rounded-md border border-[var(--border-strong)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-[#5a2a2c] bg-[#2a1618] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {outcomes.length > 0 && (
        <div className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {outcomes.map((o) => (
            <div key={o.playerId} className="panel-flat px-3 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{o.name}</span>
                {o.resolvedName && o.resolvedName !== o.name && (
                  <span className="text-[var(--text-faint)]">-&gt; {o.resolvedName}</span>
                )}
                <span className="flex-1" />
                {o.via && (
                  <span className="chip" style={{ color: "var(--info)" }}>
                    {o.via === "api" ? "API-Football" : "AI"}
                  </span>
                )}
                {o.confidence && (
                  <span
                    className="chip"
                    style={{ color: o.confidence === "alta" ? "var(--accent)" : "var(--warn)" }}
                  >
                    fiducia {o.confidence}
                  </span>
                )}
                <span
                  className="chip"
                  style={{
                    color: o.status === "ok" ? "var(--accent)" : "var(--text-faint)",
                    borderColor: o.status === "ok" ? "var(--accent-dim)" : "var(--border)",
                  }}
                >
                  {STATUS_LABEL[o.status]}
                </span>
              </div>
              {o.seasons?.map((s) => (
                <div key={`${s.season}-${s.competition}`} className="mt-0.5 text-[var(--text-faint)]">
                  {s.season} · {s.competition} · {s.matches} pres. · {s.goals} gol
                </div>
              ))}
              {o.note && <div className="mt-0.5 italic text-[var(--text-faint)]">{o.note}</div>}
              {o.message && <div className="mt-0.5 text-[var(--text-faint)]">{o.message}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="label-xs mb-2">I più costosi ancora senza dati</div>
        <div className="space-y-1">
          {coda.slice(0, 12).map((p) => (
            <div key={p.id}>
              <button
                onClick={() => setOpenPlayer(openPlayer === p.id ? null : p.id)}
                className="panel-flat flex w-full items-center gap-2 px-3 py-1.5 text-left hover:border-[var(--border-strong)]"
              >
                <RoleBadge role={p.role} size="sm" />
                <span className="flex-1 truncate text-xs font-medium">{p.name}</span>
                <span className="truncate text-[0.68rem] text-[var(--text-faint)]">{p.team}</span>
                <span className="num text-xs">{p.quotation_current ?? "—"}</span>
                <span className="text-[var(--text-faint)]">{openPlayer === p.id ? "−" : "+"}</span>
              </button>
              {openPlayer === p.id && isAdmin && <ManualForm player={p} />}
            </div>
          ))}
        </div>
        {coda.length > 12 && (
          <p className="mt-2 text-[0.68rem] text-[var(--text-faint)]">
            e altri {coda.length - 12}, quasi tutti riserve da 1 credito su cui non vale la
            pena perdere tempo.
          </p>
        )}
      </div>
    </div>
  );
}

type Usage = {
  football: {
    configured: boolean;
    ok?: boolean;
    used?: number;
    limit?: number;
    remaining?: number;
    plan?: string;
    message?: string;
  };
  openrouter: {
    configured: boolean;
    ok?: boolean;
    spent?: number;
    granted?: number;
    remaining?: number;
    model?: string;
    message?: string;
  };
};

/** Quanto e' stato consumato delle due fonti. Nessuna delle due letture costa quota. */
function UsageBar({ usage }: { usage: Usage }) {
  const f = usage.football;
  const o = usage.openrouter;
  const fPct = f.limit ? Math.min(100, ((f.used ?? 0) / f.limit) * 100) : 0;
  const oPct = o.granted ? Math.min(100, ((o.spent ?? 0) / o.granted) * 100) : 0;
  const money = (v: number | undefined) =>
    v == null ? "—" : `$${v.toFixed(v < 1 ? 4 : 2)}`;

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="panel-flat px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="label-xs">API-Football, oggi</span>
          {f.plan && <span className="text-[0.62rem] text-[var(--text-faint)]">piano {f.plan}</span>}
        </div>
        {f.configured && f.ok ? (
          <>
            <div className="num mt-0.5 text-lg font-bold">
              {f.used}
              <span className="text-xs font-normal text-[var(--text-faint)]">/{f.limit}</span>
              <span
                className="ml-2 text-xs font-semibold"
                style={{
                  color: (f.remaining ?? 0) < 10 ? "var(--danger)" : "var(--accent)",
                }}
              >
                {f.remaining} rimaste
              </span>
            </div>
            <div className="mt-1.5">
              <Bar
                value={fPct}
                max={100}
                color={fPct > 85 ? "var(--danger)" : fPct > 60 ? "var(--warn)" : "var(--accent)"}
              />
            </div>
            <div className="mt-1 text-[0.62rem] text-[var(--text-faint)]">
              Si azzerano a mezzanotte UTC · circa {Math.floor((f.remaining ?? 0) / 3)} giocatori
            </div>
          </>
        ) : (
          <div className="mt-1 text-xs text-[var(--text-faint)]">
            {f.message ?? "Non disponibile."}
          </div>
        )}
      </div>

      <div className="panel-flat px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label-xs">OpenRouter, totale speso</span>
          {o.model && (
            <span className="truncate text-[0.62rem] text-[var(--text-faint)]" title={o.model}>
              {o.model.split("/").pop()}
            </span>
          )}
        </div>
        {o.configured && o.ok ? (
          <>
            <div className="num mt-0.5 text-lg font-bold">
              {money(o.spent)}
              <span className="text-xs font-normal text-[var(--text-faint)]">
                {" "}
                di {money(o.granted)}
              </span>
              <span
                className="ml-2 text-xs font-semibold"
                style={{
                  color: (o.remaining ?? 0) <= 0 ? "var(--danger)" : "var(--accent)",
                }}
              >
                {money(o.remaining)} residui
              </span>
            </div>
            <div className="mt-1.5">
              <Bar
                value={oPct}
                max={100}
                color={oPct > 85 ? "var(--danger)" : oPct > 60 ? "var(--warn)" : "var(--accent)"}
              />
            </div>
            <div className="mt-1 text-[0.62rem] text-[var(--text-faint)]">
              Comprende anche le analisi dei giocatori in asta
            </div>
          </>
        ) : (
          <div className="mt-1 text-xs text-[var(--text-faint)]">
            {o.message ?? "Non disponibile."}
          </div>
        )}
      </div>
    </div>
  );
}

function ManualForm({ player }: { player: PlayerWithStats }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(saveManualStats, null);
  return (
    <form action={action} className="panel-flat mt-1 space-y-2 p-3">
      <input type="hidden" name="player_id" value={player.id} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label htmlFor={`s-${player.id}`}>Stagione</label>
          <input id={`s-${player.id}`} name="season" placeholder="2025-26" required />
        </div>
        <div className="col-span-2">
          <label htmlFor={`c-${player.id}`}>Campionato</label>
          <select id={`c-${player.id}`} name="competition" defaultValue="serie-b">
            {COMPETITION_OPTIONS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} — resa {Math.round(c.production * 100)}%
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`m-${player.id}`}>Presenze</label>
          <input id={`m-${player.id}`} name="matches" type="number" min={1} max={60} required />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <div>
          <label htmlFor={`g-${player.id}`}>Gol</label>
          <input id={`g-${player.id}`} name="goals" type="number" min={0} defaultValue={0} />
        </div>
        <div>
          <label htmlFor={`a-${player.id}`}>Assist</label>
          <input id={`a-${player.id}`} name="assists" type="number" min={0} defaultValue={0} />
        </div>
        <div>
          <label htmlFor={`min-${player.id}`}>Minuti</label>
          <input id={`min-${player.id}`} name="minutes" type="number" min={0} />
        </div>
        <div>
          <label htmlFor={`y-${player.id}`}>Amm.</label>
          <input id={`y-${player.id}`} name="yellow_cards" type="number" min={0} defaultValue={0} />
        </div>
        <div>
          <label htmlFor={`r-${player.id}`}>Rating</label>
          <input id={`r-${player.id}`} name="rating" type="number" step="0.01" placeholder="6.90" />
        </div>
        {player.role === "P" && (
          <div>
            <label htmlFor={`gc-${player.id}`}>Gol subiti</label>
            <input id={`gc-${player.id}`} name="goals_conceded" type="number" min={0} defaultValue={0} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-sm btn-primary" disabled={pending}>
          {pending ? "Salvo…" : "Salva"}
        </button>
        {state?.ok && <span className="text-xs text-[var(--accent)]">{state.ok}</span>}
        {state?.error && <span className="text-xs text-[var(--danger)]">{state.error}</span>}
      </div>
      <p className="text-[0.65rem] leading-relaxed text-[var(--text-faint)]">
        Il rating è quello di siti come SofaScore (scala 0-10, media 6.8): serve a stimare la media
        voto italiana, che fuori dalla Serie A non esiste. Se non ce l&apos;hai, lascia vuoto: si
        parte dalla media del ruolo.
      </p>
    </form>
  );
}
