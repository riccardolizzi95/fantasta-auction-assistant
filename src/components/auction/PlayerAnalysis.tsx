"use client";

import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { useLeague } from "@/components/LeagueDataProvider";
import { conConsigli } from "@/lib/livelli";
import { Aiuto, Bar, Fisarmonica, IconaFreccia, Interruttore, RoleBadge } from "@/components/ui";
import { recommend, VERDICT_LABEL, type Verdict } from "@/lib/fanta/recommend";
import { abbonatiAInGara, inGaraSulServer, leggiInGara } from "@/lib/fanta/inGara";
import { ROLE_LABEL, type PlayerWithStats } from "@/lib/fanta/types";
import { seasonShares } from "@/lib/fanta/valuation";
import CareerTimeline from "./CareerTimeline";
import { competitionByKey, nelloStorico, SERIE_A_KEY } from "@/lib/fanta/competitions";

const VERDICT_STYLE: Record<Verdict, { color: string; bg: string }> = {
  // Il piu' acceso di tutti: e' l'unico caso in cui non c'e' una seconda
  // occasione, e va distinto da un semplice "prendilo".
  ULTIMO_DELLA_FASCIA: {
    color: "var(--accent)",
    bg: "color-mix(in srgb, var(--accent) 26%, transparent)",
  },
  PRENDILO: { color: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 14%, transparent)" },
  AL_PREZZO_GIUSTO: { color: "var(--info)", bg: "color-mix(in srgb, var(--info) 12%, transparent)" },
  SOLO_SE_SCENDE: { color: "var(--warn)", bg: "color-mix(in srgb, var(--warn) 12%, transparent)" },
  LASCIA: { color: "var(--text-faint)", bg: "transparent" },
  NON_PUOI: { color: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 12%, transparent)" },
};

type AiInsight = {
  summary: string;
  pros: string[];
  cons: string[];
  risk: string | null;
  verdict: string | null;
  sources?: { title: string; url: string }[];
};

function PlayerAnalysis({ player }: { player: PlayerWithStats }) {
  const { state, valuations, giocatoriInAsta, lista, activeStrategy, events, participants, livello, pins, league } =
    useLeague();
  /** Se la lega ha una lista ristretta e lui non c'e', non verra' chiamato. */
  const fuoriLista = lista.size > 0 && !lista.has(player.id);
  /** Se e' lui quello sul piatto adesso: certe cose servono solo li'. */
  const inAstaAdesso = league.current_player_id === player.id;
  /** Nessuna stagione conclusa con presenze: la stima non poggia su niente di suo. */
  const senzaNumeri = !(player.history ?? []).some(
    (h) => h.season !== state.league.season && h.matches > 0,
  );
  /** Il prezzo che gli hai messo tu nella rosa ideale, se gliel'hai messo. */
  const mioPrezzo = pins.find((x) => x.player_id === player.id)?.price ?? null;
  /**
   * Senza consigli resta il giocatore, non il suggerimento.
   *
   * Cioe': chi e', dove gioca, quanto e' costato a chi l'ha preso, e tutto lo
   * storico verificabile. Sparisce ogni numero che il motore **calcola** —
   * prezzo giusto, tetto, fascia, presenze attese, ripieghi, pareggio — perche'
   * il confine e' fra fatto e giudizio, non fra dato semplice e dato complesso.
   */
  const consigli = conConsigli(livello);
  const [ai, setAi] = useState<AiInsight | null>(null);
  const [aiCost, setAiCost] = useState<{ cost: number | null; cached: boolean; model?: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [useWeb, setUseWeb] = useState(false);
  const [showMath, setShowMath] = useState(false);
  const [tuttiINumeri, setTuttiINumeri] = useState(false);
  const [mercatoAperto, setMercatoAperto] = useState(false);

  // Chi si sente rilanciare adesso: cambia il consiglio su fin dove spingere.
  const inGara = useSyncExternalStore(abbonatiAInGara, leggiInGara, inGaraSulServer);

  // Senza premium il consiglio non si calcola nemmeno: le valutazioni non sono
  // arrivate dal server, e girare il motore su una mappa vuota darebbe numeri
  // che non vogliono dire niente.
  const rec = useMemo(
    () =>
      !consigli
        ? null
        : recommend({
        player,
        state,
        valuations,
        allPlayers: giocatoriInAsta,
        strategyKey: activeStrategy?.key ?? "equilibrata",
        budgetSplit: activeStrategy?.budget_split as never,
            inGara: inGara.map((v) => v.id),
          }),
    [consigli, player, state, valuations, giocatoriInAsta, activeStrategy, inGara],
  );

  const taken = events.find((e) => e.player_id === player.id);
  const takenBy = taken?.participant_id
    ? participants.find((p) => p.id === taken.participant_id)?.name
    : null;

  const style = rec ? VERDICT_STYLE[rec.verdict] : null;
  const history = (player.history ?? []).filter((h) => h.matches > 0);
  /**
   * Lo storico che si legge: i campionati, non le coppe.
   *
   * Due di Coppa Italia e nove di Champions sono righe con tre trattini al
   * posto della fantamedia — i voti italiani li' non esistono — in mezzo alle
   * stagioni vere. Nel motore restano e pesano il giusto; qui tolgono il posto
   * a quello che si guarda davvero.
   */
  const storico = history.filter((h) => nelloStorico(h.competition));
  const nascoste = history.length - storico.length;
  const v = rec?.valuation ?? null;
  /**
   * Quanto del campione viene da fuori dalla Serie A.
   *
   * Si conta sulle presenze delle stagioni **concluse**, che e' la cosa che una
   * persona puo' verificare guardando la tabella qui sotto.
   */
  const fuoriDallItalia = useMemo(() => {
    let fuori = 0;
    let totali = 0;
    const dove = new Set<string>();
    for (const h of player.history ?? []) {
      if (h.season === state.league.season || h.matches <= 0) continue;
      totali += h.matches;
      if ((h.competition ?? SERIE_A_KEY) !== SERIE_A_KEY) {
        fuori += h.matches;
        dove.add(competitionByKey(h.competition ?? SERIE_A_KEY).label);
      }
    }
    return {
      presenze: fuori,
      totali,
      quota: totali > 0 ? fuori / totali : 0,
      dove: [...dove].join(", "),
    };
  }, [player.history, state.league.season]);

  const shares = useMemo(
    () =>
      seasonShares(player.history ?? [], player.role, {
        currentSeason: state.league.season,
        matchdaysPlayed: valuations.matchdaysPlayed,
      }),
    [player.history, player.role, state.league.season, valuations.matchdaysPlayed],
  );

  async function askAi() {
    if (!rec || !v) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/insight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: player.id,
          leagueId: state.league.id,
          web: useWeb,
          context: {
            recommendation: {
              fair: rec.fair,
              target: rec.target,
              max: rec.max,
              verdict: rec.verdict,
              tier: v.tier,
              rankInRole: v.rankInRole,
            },
            strategy: activeStrategy?.label ?? null,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Errore imprevisto");
      setAi(json.insight);
      setAiCost({ cost: json.cost ?? null, cached: !!json.cached, model: json.model });
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------- intestazione */}
      <div className="flex flex-wrap items-start gap-3">
        <RoleBadge role={player.role} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold leading-tight">{player.name}</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)]">
            <span>{player.team}</span>
            <span>·</span>
            <span>{ROLE_LABEL[player.role]}</span>
            {v && (
              <>
                <span>·</span>
                <span>
                  n° {v.rankInRole} del ruolo · fascia{" "}
                  <strong className="text-[var(--text-muted)]">{v.tier}</strong>
                </span>
              </>
            )}
            {player.quotation_current != null && (
              <>
                <span>·</span>
                <span className="num">quotazione {player.quotation_current}</span>
              </>
            )}
          </div>
          {/* Fuori dalla lista ristretta: si puo' guardare, non si puo' chiamare. */}
          {fuoriLista && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
                fuori dalla lista
              </span>
              <Aiuto largo={18}>
                La lega ha deciso una lista ristretta di giocatori chiamabili, e lui non c&apos;è:
                puoi guardarlo, ma all&apos;asta non verrà chiamato — e infatti il piano e i
                consigli non ci contano.
              </Aiuto>
            </div>
          )}

          {/* Il prezzo che gli hai messo tu.
              Va detto dove si guarda il giocatore, perche' cambia solo **il tuo
              piano**: i prezzi degli altri e i loro tetti restano quelli del
              modello, che non sa niente di quello che hai deciso tu. */}
          {mioPrezzo != null && (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="chip" style={{ color: "var(--info)", borderColor: "var(--info)" }}>
                l&apos;hai fissato tu a <span className="num font-bold">{mioPrezzo}</span>
              </span>
              <Aiuto largo={18}>
                Il prezzo che hai messo tu vale solo per la rosa che stai costruendo: il valore del
                giocatore e i tetti degli avversari restano quelli calcolati dal modello, che i tuoi
                prezzi non li vede. Altrimenti sarebbe come giocare con le loro carte in mano.
              </Aiuto>
            </div>
          )}
        </div>
        {taken && (
          <span
            className="chip"
            style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
            title="Già assegnato in questa asta"
          >
            {taken.outcome === "unsold"
              ? "non venduto"
              : `preso ${takenBy ? `da ${takenBy} ` : ""}a ${taken.price}`}
          </span>
        )}
      </div>

      {/* -------------------------------------------------- verdetto e prezzi */}
      {rec && style && (
      <div className="rounded-xl border p-4" style={{ borderColor: style.color, background: style.bg }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold tracking-tight" style={{ color: style.color }}>
              {VERDICT_LABEL[rec.verdict]}
            </div>
            <p className="mt-0.5 max-w-lg text-sm leading-snug text-[var(--text-muted)]">
              {rec.headline}
            </p>
            {/* Il tetto degli avversari e' l'informazione che fa risparmiare:
                un credito sopra il migliore fra loro basta gia'. Sotto, ogni
                credito in piu' non compra niente che non fosse gia' comprato. */}
            {rec.tettoAvversari && rec.tettoAvversari.valore + 1 < rec.max && (
              <p className="mt-1 max-w-lg text-xs leading-snug" style={{ color: "var(--warn)" }}>
                Ti basta arrivare a{" "}
                <span className="num font-bold">{rec.tettoAvversari.valore + 1}</span>:{" "}
                {rec.tettoAvversari.chi ?? "chi lo vuole"} non può andare oltre{" "}
                <span className="num">{rec.tettoAvversari.valore}</span>
                {rec.tettoAvversari.dallaVoce ? " — e lo sto sentendo rilanciare." : "."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <PriceBox label="Apri a" value={rec.target} tone="muted" />
            <PriceBox label="Prezzo giusto" value={rec.fair} tone="accent" />
            <PriceBox label="Non superare" value={rec.max} tone="danger" />
          </div>
        </div>
      </div>

      )}

      {/* -------------------------------------------------- le due strade
          Il tetto dice quanto vale lui. Questo dice cosa ti resta in mano se lo
          prendi — che a fine asta e' la domanda vera, perche' quello che compri
          con gli ultimi crediti dipende da quanti crediti restano agli altri. */}
      {rec?.piano && rec.piano.pareggio > 0 && (
        <div className="panel-flat px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="label-xs">Se lo prendi, cosa ti resta</span>
            <span className="text-xs text-[var(--text-muted)]">
              pareggi a <span className="num font-bold">{rec.piano.pareggio}</span>: oltre, conviene
              spendere quei crediti altrove
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--text-muted)]">
            <span>
              con lui <span className="num font-semibold">{rec.piano.conLui}</span> punti a giornata
            </span>
            <span>
              senza <span className="num font-semibold">{rec.piano.senzaDiLui}</span>
            </span>
            <span>
              il migliore a 1 credito rende{" "}
              <span className="num font-semibold">{rec.piano.valoreDiUnCredito}</span>
            </span>
          </div>
          {rec.piano.poi.length > 0 && (
            <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
              Col resto prenderesti:{" "}
              {rec.piano.poi.map((x) => `${x.name} a ${x.prezzo}`).join(", ")}.
            </p>
          )}
        </div>
      )}

      {/* -------------------------------------------------- alzare il prezzo
          Solo su chi e' in asta adesso.
          Alzare il prezzo e' una mossa, non un'informazione: si fa mentre il
          banditore conta, su quel giocatore li'. Su tutti gli altri era un
          numero da guardare per curiosita', e i numeri che non servono a
          decidere niente tolgono spazio a quelli che servono.

          E guarda **solo quello che gli avversari hanno gia' comprato**:
          crediti spesi, slot riempiti, quanto hanno pagato sopra i valori. Le
          loro strategie no — non le conosce nessuno, e leggerle sarebbe
          barare. */}
      {rec?.rilancio && inAstaAdesso && (
        <div
          className="panel-flat px-3 py-2.5"
          style={{ borderColor: rec.rilancio.loStaContendendo ? "var(--warn)" : undefined }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="label-xs" style={{ color: "var(--warn)" }}>
              Non ti serve — puoi farglielo pagare
            </span>
            {rec.rilancio.loStaContendendo && (
              <span className="chip" style={{ color: "var(--warn)" }}>
                lo sta rilanciando adesso
              </span>
            )}
            <span className="flex-1" />
            <Aiuto largo={20}>
              Il tetto di un avversario lo calcola su quello che ha già comprato: quanti crediti
              gli restano, quali slot ha ancora vuoti e quanto ha pagato sopra i valori finora. Le
              strategie degli altri non le legge nessuno — e se le leggesse sarebbe barare.
            </Aiuto>
          </div>
          <div className="mt-1.5 flex gap-2">
            <PriceBox label="Alza fino a" value={rec.rilancio.gratis} tone="muted" />
            <PriceBox label="Puoi arrivare a" value={rec.rilancio.finoA} tone="accent" />
            <PriceBox label="Il suo tetto" value={rec.rilancio.tettoRivale} tone="danger" />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
            {rec.rilancio.testo}
          </p>
        </div>
      )}

      {/* -------------------------------------------------- pro / contro */}
      {rec && (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="panel-flat p-3">
          <div className="label-xs mb-2" style={{ color: "var(--accent)" }}>
            A favore
          </div>
          {rec.pros.length ? (
            <ul className="space-y-1.5">
              {rec.pros.map((p) => (
                <li key={p} className="flex gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
                  <span style={{ color: "var(--accent)" }}>+</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--text-faint)]">Niente che lo faccia spiccare.</p>
          )}
        </div>
        <div className="panel-flat p-3">
          <div className="label-xs mb-2" style={{ color: "var(--danger)" }}>
            Contro
          </div>
          {rec.cons.length ? (
            <ul className="space-y-1.5">
              {rec.cons.map((p) => (
                <li key={p} className="flex gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
                  <span style={{ color: "var(--danger)" }}>−</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--text-faint)]">Nessun rischio evidente.</p>
          )}
        </div>
      </div>

      )}

      {/* -------------------------------------------------- lettura del mercato */}
      {/* Chiuso di suo: e' il contorno, non la decisione.
          Sono tre o quattro righe sullo stato del mercato che si leggono una
          volta ogni tanto, e aperte spingevano in fondo allo schermo le cose
          che si guardano a ogni chiamata. */}
      {rec && rec.notes.length > 0 && (
        <div className="panel-flat">
          {/* Il tasto e' tutta la riga, bordi compresi: la spaziatura sta
              dentro al bottone e non intorno, cosi' non ci sono punti morti
              dove premi e non succede niente. */}
          <button
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            onClick={() => setMercatoAperto((x) => !x)}
            aria-expanded={mercatoAperto}
          >
            <span className="label-xs">Come sta andando l&apos;asta</span>
            <span className="text-[0.62rem] text-[var(--text-faint)]">
              {rec.notes.length} {rec.notes.length === 1 ? "nota" : "note"}
            </span>
            <span className="flex-1" />
            <span className="text-[var(--text-faint)]">
              <IconaFreccia aperta={mercatoAperto} />
            </span>
          </button>
          <Fisarmonica aperta={mercatoAperto}>
            <ul className="space-y-1.5 px-3 pb-3">
              {rec.notes.map((n) => (
                <li key={n} className="flex gap-2 text-xs leading-relaxed text-[var(--text-muted)]">
                  <span className="text-[var(--text-faint)]">▸</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </Fisarmonica>
        </div>
      )}

      {/* -------------------------------------------------- numeri */}
      {v && (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Presenze attese" value={Math.round(v.expApps)} suffix="/38" />
        <MiniStat label="Fantamedia attesa" value={v.expFM.toFixed(2)} />
        <MiniStat label="Media voto attesa" value={v.expMV.toFixed(2)} />
        <MiniStat
          label="Bonus modificatore"
          value={v.defModBonus ? `+${v.defModBonus.toFixed(2)}` : "—"}
        />
      </div>
      )}

      {/* Quando di lui non sappiamo niente, dirlo.
          La stima esce lo stesso — deve uscire, perche' all'asta lo chiamano
          comunque — ma non nasce da una partita giocata: nasce dalla
          quotazione ufficiale, che e' il giudizio del mercato su di lui, tirato
          verso la media del ruolo in proporzione a quanto poco sappiamo. E'
          una cosa diversa da un dato, e chi decide deve poterla distinguere. */}
      {consigli && senzaNumeri && (
        <div
          className="rounded-lg border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: "var(--warn)",
            background: "color-mix(in srgb, var(--warn) 8%, transparent)",
          }}
        >
          <strong style={{ color: "var(--warn)" }}>Di lui non abbiamo numeri.</strong> Nessuna
          stagione con presenze, né in Italia né altrove: la stima parte dalla quotazione
          ufficiale e dalla media del suo ruolo. Trattala come un prezzo di listino, non come una
          previsione.
        </div>
      )}

      {/* L'avviso compariva appena una riga veniva da fuori, e su chi ha quattro
          stagioni di Serie A alle spalle diceva una cosa falsa: "le statistiche
          vengono dalla Champions League". Quanto pesano davvero cambia tutto —
          per un arrivo dall'estero sono tutto quello che c'e', per Lautaro sono
          una coda. */}
      {consigli && fuoriDallItalia.presenze > 0 && fuoriDallItalia.quota >= 0.15 && (
        <div
          className="rounded-lg border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: fuoriDallItalia.quota >= 0.6 ? "var(--info)" : "var(--border-strong)",
            background:
              fuoriDallItalia.quota >= 0.6
                ? "color-mix(in srgb, var(--info) 8%, transparent)"
                : "transparent",
          }}
        >
          {fuoriDallItalia.quota >= 0.6 ? (
            <>
              <strong style={{ color: "var(--info)" }}>Stima da un altro campionato.</strong> Quasi
              tutto quello che sappiamo di lui viene da {fuoriDallItalia.dove}: gol e assist sono
              riportati alla scala della Serie A e il campione pesa meno di uno italiano. Fuori
              dall&apos;Italia la media voto non esiste, quindi quella parte è ricostruita — trattalo
              come una stima ragionata, non come un dato.
            </>
          ) : (
            <>
              <span className="font-semibold">
                {fuoriDallItalia.presenze} delle {fuoriDallItalia.totali} presenze considerate
              </span>{" "}
              vengono da {fuoriDallItalia.dove}. Lì gol e assist sono riportati alla scala della
              Serie A, mentre la media voto è tutta italiana: fuori non esiste. Misurato su 162
              giocatori, tenerle migliora leggermente la stima invece di peggiorarla.
            </>
          )}
        </div>
      )}

      <CareerTimeline player={player} />

      {storico.length > 0 && (
        <div className="panel-flat p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="label-xs">Storico</span>
            <span className="text-[0.62rem] text-[var(--text-faint)]">
              {v
                ? v.seasonsUsed.length > 1
                  ? `${v.seasonsUsed.length} stagioni pesate nel calcolo`
                  : "una sola stagione disponibile"
                : `${history.length} ${history.length === 1 ? "stagione" : "stagioni"}`}
              {valuations.matchdaysPlayed > 0 && ` · ${valuations.matchdaysPlayed}ª giornata`}
            </span>
          </div>

          {/* Una riga per stagione, e nient'altro.
              La tabella di prima aveva tredici colonne tutte della stessa
              dimensione: c'era tutto e non si capiva niente. La versione a
              schede era leggibile ma lunga il doppio — e in un'asta lo spazio
              vale piu' dell'eleganza. Qui restano le colonne, ma con le
              presenze disegnate e la fantamedia in evidenza: si leggono
              scorrendo l'occhio in verticale, senza contare i numeri. */}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[0.6rem] uppercase tracking-wide text-[var(--text-faint)]">
                <th className="pb-1 font-medium">Stagione</th>
                <th className="pb-1 font-medium">Squadra</th>
                <th className="pb-1 font-medium">Presenze</th>
                <th className="pb-1 text-right font-medium">FM</th>
                <th className="pb-1 text-right font-medium">MV</th>
                {player.role === "P" ? (
                  <>
                    <th className="pb-1 text-right font-medium">Sub</th>
                    <th className="pb-1 text-right font-medium" title="Rigori parati">Rp</th>
                  </>
                ) : (
                  <>
                    <th className="pb-1 text-right font-medium">Gol</th>
                    <th className="pb-1 text-right font-medium">Ass</th>
                  </>
                )}
                <th className="pb-1 text-right font-medium" title="Ammonizioni">Amm</th>
                <th className="pb-1 text-right font-medium" title="Espulsioni">Esp</th>
                {consigli && <th className="pb-1 text-right font-medium">Peso</th>}
              </tr>
            </thead>
            <tbody>
              {storico.map((row) => {
                const share = shares.get(row.season) ?? 0;
                const isCurrent = row.season === state.league.season;
                const comp = competitionByKey(row.competition ?? SERIE_A_KEY);
                return (
                  <tr
                    key={`${row.season}-${row.competition ?? SERIE_A_KEY}`}
                    className="border-t border-[var(--border)]"
                    style={{ opacity: share > 0 ? 1 : 0.5 }}
                  >
                    <td className="py-1 pr-3 align-middle">
                      <span className="num">{row.season}</span>
                      {comp.key === SERIE_A_KEY ? (
                        isCurrent && (
                          <span className="ml-1.5 text-[0.6rem]" style={{ color: "var(--warn)" }}>
                            in corso
                          </span>
                        )
                      ) : (
                        <span
                          className="ml-1.5 text-[0.6rem]"
                          style={{ color: "var(--info)" }}
                          title={`Gol e assist convertiti al ${Math.round(comp.production * 100)}% della resa in Serie A`}
                        >
                          {comp.label}
                        </span>
                      )}
                      <span className="ml-1.5 text-[0.6rem]">
                        <SourceTag row={row} />
                      </span>
                    </td>
                    {/* Dove giocava.
                        Senza, lo storico di chi arriva da fuori e' una colonna
                        di numeri senza un posto: "29 presenze" non dice se
                        erano in Liga o in Serie B, e due mezze stagioni in due
                        squadre diverse sembravano una stagione sola. */}
                    <td className="py-1 pr-3 align-middle text-[0.68rem] text-[var(--text-muted)]">
                      {row.club ? (
                        <span className="truncate">{row.club}</span>
                      ) : (
                        <span className="text-[var(--text-faint)]">—</span>
                      )}
                    </td>
                    <td className="py-1 pr-3 align-middle">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-16">
                          <Bar
                            value={row.matches}
                            max={38}
                            color={row.matches >= 25 ? "var(--accent)" : "var(--border-strong)"}
                          />
                        </span>
                        <span className="num text-[0.68rem] text-[var(--text-faint)]">
                          {row.matches}
                        </span>
                      </span>
                    </td>
                    <td
                      className="num py-1 text-right font-bold"
                      style={{ color: row.avg_fantavote != null ? "var(--accent)" : "var(--text-faint)" }}
                    >
                      {row.avg_fantavote != null ? Number(row.avg_fantavote).toFixed(2) : "—"}
                    </td>
                    <td className="num py-1 pl-2 text-right text-[var(--text-muted)]">
                      {row.avg_vote != null ? Number(row.avg_vote).toFixed(2) : "—"}
                    </td>
                    {/* Le colonne che contano cambiano con il ruolo: i gol di un
                        portiere sono sempre zero, i rigori parati di un
                        attaccante pure. */}
                    {player.role === "P" ? (
                      <>
                        <td className="num py-1 pl-2 text-right text-[var(--text-muted)]">
                          {row.goals_conceded}
                        </td>
                        <td className="num py-1 pl-2 text-right text-[var(--text-muted)]">
                          {row.pen_saved}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="num py-1 pl-2 text-right text-[var(--text-muted)]">{row.goals}</td>
                        <td className="num py-1 pl-2 text-right text-[var(--text-muted)]">{row.assists}</td>
                      </>
                    )}
                    <td className="num py-1 pl-2 text-right text-[var(--text-muted)]">
                      {row.yellow_cards}
                    </td>
                    <td
                      className="num py-1 pl-2 text-right"
                      style={{ color: row.red_cards > 0 ? "var(--danger)" : "var(--text-muted)" }}
                    >
                      {row.red_cards}
                    </td>
                    {consigli && (
                      <td
                        className="num py-1 pl-2 text-right text-[var(--text-faint)]"
                        title={
                          isCurrent
                            ? "Poche giornate contano poco: il peso cresce col passare del campionato"
                            : "Quanto questa stagione pesa nel prezzo calcolato"
                        }
                      >
                        {share > 0 ? `${Math.round(share * 100)}%` : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {nascoste > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[0.62rem] text-[var(--text-faint)]">
              {nascoste} {nascoste === 1 ? "riga nascosta" : "righe nascoste"}: coppe e campionati
              non riconosciuti
              <Aiuto largo={18}>
                Poche partite e nessuna fantamedia — fuori dall&apos;Italia i voti non esistono —
                quindi a schermo sarebbero righe di trattini. Nel calcolo del prezzo restano, con il
                peso che gli spetta.
              </Aiuto>
            </p>
          )}
          <button
            className="mt-2 text-[0.68rem] text-[var(--text-faint)] underline underline-offset-2 hover:text-[var(--text-muted)]"
            onClick={() => setTuttiINumeri((x) => !x)}
          >
            {tuttiINumeri ? "nascondi i numeri di dettaglio" : "tutti i numeri"}
          </button>

          {tuttiINumeri && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-faint)]">
                    <th className="pb-1 font-medium">Stagione</th>
                    <th className="pb-1 font-medium">Campionato</th>
                    <th className="pb-1 font-medium">Rig. +/−</th>
                    <th className="pb-1 font-medium">Autogol</th>
                    <th className="pb-1 font-medium">Minuti</th>
                    <th className="pb-1 font-medium">Fonte</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {/* Qui c'e' tutto, anche le coppe: e' il posto dove si va a
                      guardare, non quello che si legge di sfuggita. */}
                  {history.map((row) => (
                    <tr key={`n-${row.season}-${row.competition ?? SERIE_A_KEY}-${row.club ?? ""}`}>
                      <td className="pr-3">{row.season}</td>
                      <td className="pr-3 text-[var(--text-faint)]">
                        {competitionByKey(row.competition ?? SERIE_A_KEY).label}
                      </td>
                      <td className="pr-3">
                        {row.pen_scored}/{row.pen_missed}
                      </td>
                      <td className="pr-3">{row.own_goals}</td>
                      <td className="pr-3">{row.minutes ?? "—"}</td>
                      <td className="pr-3">
                        <SourceTag row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {storico.some((h) => (h.source ?? "import") !== "import") && (
            <p className="mt-2 text-[0.65rem] leading-relaxed text-[var(--text-faint)]">
              Le righe con l&apos;asterisco vengono da fuori il file ufficiale: passa il mouse sulla
              fonte per vedere come è stato identificato il giocatore e da dove arrivano i numeri.
            </p>
          )}
        </div>
      )}

      {/* -------------------------------------------------- alternative */}
      {/* Il ripiego non e' un elenco decorativo: il suo prezzo e' quello che
          decide fino a dove conviene spingersi su di lui. Sta in tre righe
          perche' e' una cosa che si guarda mentre il banditore conta, non un
          capitolo da leggere. */}
      {rec &&
        (rec.alternatives.length > 0 ? (
          <div className="panel-flat p-3">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="label-xs">Se lo perdi</span>
              <span className="text-[0.62rem] text-[var(--text-faint)]">
                il salto vale{" "}
                <span className="num text-[var(--text-muted)]">{rec.premioSulRipiego}</span> crediti
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Puoi spingerti fino a <strong className="num">{rec.max}</strong>; dopo di lui c&apos;è{" "}
              <strong>{rec.alternatives[0].name}</strong> intorno a{" "}
              <strong className="num">{rec.alternatives[0].fair}</strong>
              {rec.alternatives[0].somiglia ? `, ${rec.alternatives[0].somiglia}` : ""}
              {rec.alternatives[0].differisce ? `, ma ${rec.alternatives[0].differisce}` : ""}.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {rec.alternatives.map((a) => (
                <span
                  key={a.id}
                  className="chip"
                  title={[a.somiglia, a.differisce].filter(Boolean).join(" · ") || undefined}
                >
                  {a.name}
                  <span className="ml-1 text-[var(--text-faint)]">{a.team}</span>
                  <span className="num ml-1.5" style={{ color: "var(--accent)" }}>
                    {a.fair}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="panel-flat p-3" style={{ borderColor: "var(--accent-dim)" }}>
            <div className="label-xs mb-1" style={{ color: "var(--accent)" }}>
              Non ci sono ricambi
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Nella sua fascia non resta nessun altro del ruolo: se lo perdi, il prossimo è di un
              altro livello, ed è per questo che il tetto sale a{" "}
              <strong className="num">{rec.max}</strong>. Se non ci arrivi, sposta i crediti su un
              reparto dove i ricambi ci sono ancora.
            </p>
          </div>
        ))}

      {/* -------------------------------------------------- analisi AI */}
      {rec && (
      <div className="panel-flat p-3">
        <div className="label-xs">Contesto qualitativo</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-faint)]">
          Quello che i numeri della scorsa stagione non dicono: mercato, ruolo nella squadra,
          concorrenza, infortuni.
        </p>
        {/* La casella di spunta e' sparita: quella scelta costa dei soldi veri e
            merita di dire quanti, non una parola in grigio accanto a un
            quadratino. L'interruttore e' lo stesso di tutto il resto
            dell'applicazione, e sotto c'e' il prezzo. */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
          <Interruttore
            acceso={useWeb}
            onChange={setUseWeb}
            titolo={<span className="text-xs">Cerca notizie sul web</span>}
            sotto={
              useWeb
                ? "$0,007 a richiesta: serve se si è mosso di recente — infortuni, mercato, panchine."
                : "Senza: risponde su quello che sa già, e non costa quasi niente."
            }
          />
          <button
            className={`btn btn-sm shrink-0 ${ai ? "" : "btn-primary"}`}
            onClick={askAi}
            disabled={aiLoading}
          >
            {aiLoading ? "Analizzo…" : ai ? "Rigenera" : "Chiedi all'AI"}
          </button>
        </div>
        {aiError && <p className="mt-2 text-xs text-[var(--danger)]">{aiError}</p>}
        {ai && (
          <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">{ai.summary}</p>
            {ai.pros?.length > 0 && (
              <ul className="space-y-1">
                {ai.pros.map((p) => (
                  <li key={p} className="flex gap-2 text-xs text-[var(--text-muted)]">
                    <span style={{ color: "var(--accent)" }}>+</span>
                    {p}
                  </li>
                ))}
              </ul>
            )}
            {ai.cons?.length > 0 && (
              <ul className="space-y-1">
                {ai.cons.map((p) => (
                  <li key={p} className="flex gap-2 text-xs text-[var(--text-muted)]">
                    <span style={{ color: "var(--danger)" }}>−</span>
                    {p}
                  </li>
                ))}
              </ul>
            )}
            {ai.risk && (
              <p className="text-xs text-[var(--warn)]">
                <strong>Rischio principale:</strong> {ai.risk}
              </p>
            )}
            {aiCost && (
              <p className="text-[0.65rem] text-[var(--text-faint)]">
                {aiCost.cached
                  ? "Ripreso dalla cache: nessun costo."
                  : `Costo di questa analisi: $${(aiCost.cost ?? 0).toFixed(4)}${aiCost.model ? ` · ${aiCost.model.split("/").pop()}` : ""}`}
              </p>
            )}
            <p className="text-[0.65rem] text-[var(--text-faint)]">
              {useWeb
                ? "Generato da un modello linguistico con ricerca web: le fonti online non sono verificate."
                : "Generato da un modello linguistico: usalo come contesto, non come dato."}{" "}
              I prezzi restano quelli calcolati sui numeri.
            </p>
          </div>
        )}
      </div>

      )}

      {/* -------------------------------------------------- come ci arriva */}
      {rec && (
      <>
      <button
        className="text-xs text-[var(--text-faint)] underline underline-offset-2 hover:text-[var(--text-muted)]"
        onClick={() => setShowMath((v) => !v)}
      >
        {showMath ? "Nascondi" : "Mostra"} come è stato calcolato il prezzo
      </button>
      {showMath && (
        <div className="panel-flat space-y-1.5 p-3 text-xs text-[var(--text-muted)]">
          <Row k="Valore base (modello, mercato neutro)" v={`${rec.breakdown.baseValue} cr`} />
          <Row k="Prezzo di listino (Fantavalore ufficiale)" v={`${rec.breakdown.marketPrice} cr`} />
          <Row k="× moltiplicatore della tua strategia" v={`${rec.breakdown.strategyMultiplier}`} />
          <Row k="× inflazione del ruolo in questa asta" v={`${rec.breakdown.inflation}`} />
          <Row k="× scarsità del momento" v={`${rec.breakdown.scarcityFactor}`} />
          <Row k="= prezzo giusto" v={`${rec.fair} cr`} strong />
          <div className="my-1 border-t border-[var(--border)]" />
          <Row k="Tetto del tuo piano per il ruolo" v={`${rec.breakdown.planCap} cr`} />
          <Row k="Massimo che puoi offrire (rosa da completare)" v={`${rec.breakdown.myMaxBid} cr`} />
          <Row
            k="Massimo che può offrire un avversario"
            v={`${rec.breakdown.rivalCeiling} cr${rec.breakdown.rivalName ? ` (${rec.breakdown.rivalName})` : ""}`}
          />
          <Row
            k="Concorrenza su questa fascia"
            v={`${rec.breakdown.demand} squadre / ${rec.breakdown.supply} giocatori`}
          />
          <Row k="= tetto massimo consigliato" v={`${rec.max} cr`} strong />
        </div>
      )}
      </>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, { label: string; color: string; help: string }> = {
  import: {
    label: "file ufficiale",
    color: "var(--accent)",
    help: "Dal file scaricato da Fantacalcio.it: e' il dato vero, non una ricostruzione.",
  },
  api: {
    label: "API-Football",
    color: "var(--info)",
    help: "Archivio sportivo. Verificabile, ma la produzione e' convertita alla scala della Serie A.",
  },
  ai: {
    label: "AI",
    color: "var(--warn)",
    help: "Ricostruita da un modello linguistico. Pesa il 35% in meno delle altre fonti.",
  },
  manual: {
    label: "inserita a mano",
    color: "var(--text-muted)",
    help: "Inserita manualmente da un amministratore.",
  },
};

/** Da dove viene questa riga, e con quale nome il giocatore e' stato identificato. */
function SourceTag({ row }: { row: NonNullable<PlayerWithStats["stats"]> }) {
  const meta = SOURCE_LABEL[row.source ?? "import"] ?? SOURCE_LABEL.import;
  const d = row.source_detail;
  const dettagli = [
    d?.resolved_name ? `identificato come ${d.resolved_name}` : null,
    d?.api_name && d.api_name !== d.resolved_name ? `trovato come ${d.api_name}` : null,
    d?.club ? `al ${d.club}` : null,
    d?.confidence ? `fiducia ${d.confidence}` : null,
    d?.model ? `modello ${d.model.split("/").pop()}` : null,
    d?.web ? "con ricerca web" : null,
    d?.note ?? null,
  ].filter(Boolean);

  return (
    <span
      style={{ color: meta.color }}
      title={[meta.help, ...dettagli].join(" · ")}
      className="cursor-help"
    >
      {meta.label}
      {dettagli.length > 0 && <span className="ml-0.5 text-[var(--text-faint)]">*</span>}
    </span>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={strong ? "font-semibold text-[var(--text)]" : ""}>{k}</span>
      <span className={`num ${strong ? "font-bold text-[var(--accent)]" : ""}`}>{v}</span>
    </div>
  );
}

function PriceBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "accent" | "danger";
}) {
  const color =
    tone === "accent" ? "var(--accent)" : tone === "danger" ? "var(--danger)" : "var(--text-muted)";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)]/40 px-3 py-2 text-center">
      <div className="label-xs whitespace-nowrap">{label}</div>
      <div className="num text-2xl font-bold leading-tight" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="panel-flat px-3 py-2">
      <div className="label-xs">{label}</div>
      <div className="num mt-0.5 text-base font-bold">
        {value}
        {suffix && <span className="text-xs font-normal text-[var(--text-faint)]">{suffix}</span>}
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
export default memo(PlayerAnalysis);
