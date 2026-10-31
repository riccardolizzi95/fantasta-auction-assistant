"use client";

import { memo, useMemo, useState } from "react";
import Link from "next/link";
import { useLeague } from "@/components/LeagueDataProvider";
import { Aiuto, IconaCroce, IconaMatita, IconaSpunta, RoleBadge } from "@/components/ui";
import { mercatoCorrente } from "@/lib/fanta/recommend";
import { perchePianoImpossibile, probabilitaA, rosaIdeale, scalaPrezzi } from "@/lib/fanta/piano";
import { getStrategy, normalizeSplit, QUOTA_GIOCATORE_DEFAULT } from "@/lib/fanta/strategies";
import { conConsigli } from "@/lib/livelli";
import { indicizza, paroleDi, punteggio } from "@/lib/fanta/ricerca";
import { ROLE_LABEL_SHORT, ROLES, type Role, type RoleMap } from "@/lib/fanta/types";

/**
 * La rosa che stai costruendo, non quella che vorresti.
 *
 * Non e' una previsione dell'asta — nessuno sa chi verra' chiamato e quando — e'
 * **la fotografia del piano adesso**: quello che hai gia' in rosa, piu' quello
 * che con i crediti rimasti e i prezzi di adesso riusciresti a prendere. E il
 * "riusciresti" e' pesato: un obiettivo che in tre si contendono vale un quarto
 * di un obiettivo che nessuno vuole.
 *
 * Serve a vedere due cose che nei consigli sui singoli giocatori non si vedono:
 * dove sei scoperto, e **come si muove il piano mentre l'asta va avanti**. Quando
 * un top va via a 250 questa cambia, e il modo in cui cambia dice piu' di venti
 * prezzi.
 */
/** Verde se te lo porti a casa quasi sicuro, ambra se e' una scommessa. */
const coloreProbabilita = (p: number) =>
  p >= 0.75 ? "var(--accent)" : p >= 0.4 ? "var(--text-faint)" : "var(--warn)";

function RosaIdeale() {
  const { giocatoriInAsta, playerMap, state, valuations, activeStrategy, livello, pins, setPin, removePin, clearPins } =
    useLeague();
  // Senza consigli resta la rosa e basta: gli slot che hai riempito davvero e
  // quelli vuoti. Nessun obiettivo, nessun prezzo, nessuna proiezione.
  const consigli = conConsigli(livello);
  const [aperto, setAperto] = useState(true);
  const [modifica, setModifica] = useState(false);
  /** Quale riga della rosa stai compilando, se ne stai compilando una. */
  const [rigaAperta, setRigaAperta] = useState<string | null>(null);
  const me = state.me;

  /**
   * La rosa: quello che hai preso, quello che hai deciso tu, quello che il
   * piano ci metterebbe.
   *
   * Senza premium il mercato che passa al piano e' vuoto: niente obiettivi,
   * niente prezzi consigliati. Restano i giocatori comprati e quelli che hai
   * scelto a mano — che e' esattamente quello che serve per portare un piano
   * all'asta senza farsi suggerire niente.
   */
  const piano = useMemo(() => {
    if (!me) return null;
    const split = normalizeSplit(
      (activeStrategy?.budget_split as never) ??
        getStrategy(activeStrategy?.key ?? "equilibrata")?.budgetSplit ?? {
          P: 0.07,
          D: 0.16,
          C: 0.33,
          A: 0.44,
        },
    );
    const mercato = consigli
      ? mercatoCorrente({
          state,
          valuations,
          // Il piano si costruisce su chi verra' chiamato davvero: se la lega
          // ha una lista ristretta, contare su un ricambio che all'asta non
          // esiste e' peggio che non contarci.
          allPlayers: giocatoriInAsta,
          strategyKey: activeStrategy?.key ?? "equilibrata",
          budgetSplit: activeStrategy?.budget_split as never,
        })
      : [];

    // Quello che hai scelto tu entra per primo e non esce: il resto del piano
    // si costruisce con i crediti e gli slot che avanzano.
    const presi = new Set(me.roster.map((r) => r.player.id));
    const fissati = pins
      .filter((x) => !presi.has(x.player_id))
      .map((x) => {
        const g = playerMap.get(x.player_id);
        const v = valuations.byPlayer.get(x.player_id);
        // La probabilita' a **quel** prezzo, non a quello di mercato: e' la
        // risposta alla domanda che uno si fa scegliendo una cifra a mano.
        const nelMercato = mercato.find((c) => c.id === x.player_id);
        return g
          ? {
              playerId: g.id,
              name: g.name,
              role: g.role,
              prezzo: x.price,
              expFM: v?.expFM ?? 0,
              expMV: v?.expMV ?? 0,
              expApps: v?.expApps ?? 0,
              probabilita: nelMercato ? probabilitaA(nelMercato, x.price) : 1,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return rosaIdeale({
      rosa: me.roster.map((r) => ({
        role: r.player.role,
        name: r.player.name,
        prezzo: r.price,
        expFM: r.valuation?.expFM ?? valuations.byPlayer.get(r.player.id)?.expFM ?? 0,
        expMV: r.valuation?.expMV ?? valuations.byPlayer.get(r.player.id)?.expMV ?? 0,
        expApps: r.valuation?.expApps ?? valuations.byPlayer.get(r.player.id)?.expApps ?? 0,
      })),
      slotsLiberi: me.slotsLeft,
      crediti: me.remaining,
      mercato,
      fissati,
      ctx: {
        replacementFM: valuations.replacementFM,
        replacementMV: valuations.replacementMV,
        modificatore: state.league.rules.defense_modifier,
      },
      // La forma della rosa: quanto sul primo, quanto sul secondo, reparto per
      // reparto. Senza, due strategie con la stessa quota d'attacco davano la
      // stessa identica rosa — cambiava quanto, mai come.
      scala: scalaPrezzi({
        split,
        slotsLiberi: me.slotsLeft,
        spesoPerRuolo: me.spentByRole,
        topTargets: getStrategy(activeStrategy?.key ?? "equilibrata")?.topTargets ?? {
          P: 1,
          D: 1,
          C: 2,
          A: 1,
        },
        budgetTotale: me.participant.budget_total,
        tettoMax: Math.round(
          (activeStrategy?.max_quota_giocatore ?? QUOTA_GIOCATORE_DEFAULT) *
            me.participant.budget_total,
        ),
        aMano: (activeStrategy?.price_ladder as Partial<RoleMap<number[]>>) ?? null,
      }),
    });
  }, [me, consigli, giocatoriInAsta, playerMap, pins, state, valuations, activeStrategy]);

  if (!me || !piano) return null;

  // Il valore della rosa intera: quello che hai gia' pagato, piu' quello che il
  // piano impegna — scelte a mano comprese.
  const scelti = piano.slots.reduce((a, x) => a + (x.scelto?.prezzo ?? 0), 0);
  const valoreRosa = me.spent + piano.impegnati;
  const sforato = Math.max(0, valoreRosa - me.participant.budget_total);
  const coloreTotale =
    sforato > 0
      ? "var(--danger)"
      : valoreRosa >= me.participant.budget_total * 0.97
        ? "var(--accent)"
        : "var(--text)";

  return (
    <div className="panel">
      {/* La strategia attiva stava in un pannello a parte, sopra: due riquadri
          per la stessa domanda — con che criterio sto costruendo questa rosa.
          Adesso il criterio e' scritto sopra la rosa che ne esce. */}
      {consigli && (
        <div className="border-b border-[var(--border)] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="label-xs" title="Solo tua: gli altri non la vedono">
                Strategia · privata
              </div>
              {/* Su una colonna da 300px "Spalmata (nessun top) · max 70 cr su
                  uno" non ci sta su una riga, e troncato non dice niente: due
                  righe costano otto pixel e si legge. */}
              <div className="mt-0.5 text-xs font-semibold leading-snug">
                {activeStrategy?.label ?? "Nessuna"}
              </div>
              {activeStrategy && (
                <div className="mt-0.5 text-[0.62rem] leading-snug text-[var(--text-faint)]">
                  {activeStrategy.price_ladder
                    ? "scala dei prezzi scritta a mano"
                    : activeStrategy.max_quota_giocatore == null
                      ? "tetto per giocatore deciso dal software"
                      : `max ${Math.round(
                          activeStrategy.max_quota_giocatore * me.participant.budget_total,
                        )} crediti su un giocatore solo`}
                </div>
              )}
            </div>
            <Link href={`/lega/${state.league.id}/strategia`} className="btn btn-sm shrink-0">
              Cambia
            </Link>
          </div>
        </div>
      )}

      <button
        className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setAperto((x) => !x)}
      >
        <span className="text-xs font-semibold">
          {consigli ? "La rosa che stai costruendo" : "Chi hai preso"}
        </span>
        <span className="flex items-baseline gap-2">
          {consigli && (
            <span className="num text-sm font-bold" style={{ color: "var(--accent)" }}>
              {piano.punti}
            </span>
          )}
          <span className="text-[0.62rem] text-[var(--text-faint)]">{aperto ? "−" : "+"}</span>
        </span>
      </button>

      {aperto && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.6rem] leading-snug text-[var(--text-faint)]">
            {consigli ? (
              <>
                <span>
                  <span style={{ color: "var(--accent)" }}>✓</span> preso davvero ·{" "}
                  <span className="num">○</span> ipotesi, col prezzo fra parentesi: in{" "}
                  <span style={{ color: "var(--info)" }}>azzurro</span> quelli scelti da te, in
                  grigio gli obiettivi del modello.
                </span>
                <Aiuto largo={20}>
                  I punti qui sopra sono quelli attesi a giornata se il piano va come dice, e si
                  muovono a ogni chiamata registrata: quando un top va via, quello che resta
                  comprabile cambia. I prezzi che hai messo tu valgono solo per il tuo piano: i
                  prezzi degli avversari e le probabilità li calcola il modello, che le tue scelte
                  non le vede — altrimenti sarebbe come giocare con le loro carte in mano.
                </Aiuto>
              </>
            ) : (
              <span>
                Chi hai già preso, e quanto hai pagato. Gli slot ancora da riempire sono in grigio.
              </span>
            )}
          </p>

          {ROLES.map((r) => {
            const slots = piano.slots.filter((s) => s.role === r);
            if (slots.length === 0) return null;
            return (
              <div key={r} className="mb-1.5 last:mb-0">
                <div className="mb-0.5 flex items-baseline gap-1.5">
                  <RoleBadge role={r as Role} size="sm" />
                  <span className="label-xs">{ROLE_LABEL_SHORT[r]}</span>
                </div>
                <ul>
                  {slots.map((s, i) => {
                    const modificabile = modifica && !s.preso && rigaAperta !== `${r}-${i}`;
                    return (
                    <li
                      key={`${r}-${i}`}
                      className={`flex items-center gap-2 rounded px-1 text-[0.68rem] leading-[1.45rem] ${
                        modificabile
                          ? "cursor-pointer ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--bg-elevated)] hover:ring-[var(--accent-dim)]"
                          : ""
                      }`}
                      style={{ opacity: s.titolare ? 1 : 0.6 }}
                      onClick={modificabile ? () => setRigaAperta(`${r}-${i}`) : undefined}
                    >
                      {modifica && !s.preso && rigaAperta === `${r}-${i}` ? (
                        <SceltaSullaRiga
                          role={r as Role}
                          suggerito={s.obiettivo?.prezzo ?? s.scelto?.prezzo ?? null}
                          crediti={me.remaining}
                          slotsLiberi={me.totalSlotsLeft}
                          altreScelte={pins
                            .filter((x) => x.player_id !== s.scelto?.playerId)
                            .map((x) => x.price)}
                          altrove={(id) => {
                            const gia = pins.find((x) => x.player_id === id);
                            return gia && id !== s.scelto?.playerId ? gia.price : null;
                          }}
                          onAdd={async (playerId, prezzo) => {
                            const res = await setPin(playerId, prezzo);
                            if (!res.error) setRigaAperta(null);
                            return res;
                          }}
                          onAnnulla={() => setRigaAperta(null)}
                        />
                      ) : (
                        /* Le colonne stanno ferme.
                           Ogni riga ha sempre le stesse quattro caselle —
                           nome, prezzo, probabilita', comandi — anche quando
                           una e' vuota. Prima chi era stato scelto a mano
                           aveva una crocetta in piu' e spingeva il prezzo a
                           sinistra rispetto alle righe sopra: venticinque
                           numeri che non stavano su una colonna. */
                        <>
                          {/* Preso o ipotesi, senza dover ricordare i colori.
                              Una spunta o un cerchietto vuoto, in una casella
                              di larghezza fissa uguale per tutte le righe:
                              cosi' le colonne restano incolonnate e la
                              differenza si vede anche di sfuggita, da lontano
                              e su uno schermo storto. */}
                          <span
                            className="shrink-0 text-center text-[0.6rem]"
                            style={{
                              width: "0.75rem",
                              color: s.preso ? "var(--accent)" : "var(--text-faint)",
                            }}
                            title={s.preso ? "Preso davvero" : "Ipotesi: non è ancora tuo"}
                          >
                            {s.preso ? "✓" : s.scelto || s.obiettivo ? "○" : ""}
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate"
                            style={{
                              color: s.preso
                                ? undefined
                                : s.scelto
                                  ? "var(--info)"
                                  : s.obiettivo
                                    ? "var(--text-muted)"
                                    : "var(--text-faint)",
                            }}
                            title={s.scelto ? "Prezzo messo da te" : undefined}
                          >
                            {s.preso?.name ??
                              s.scelto?.name ??
                              (consigli ? s.obiettivo?.name : null) ??
                              "— da riempire"}
                          </span>
                          <span
                            className="num shrink-0 text-right"
                            style={{
                              width: "2.4rem",
                              color: s.preso
                                ? "var(--accent)"
                                : s.scelto
                                  ? "var(--info)"
                                  : "var(--text-faint)",
                            }}
                          >
                            {/* Fra parentesi quando non e' tuo: un numero fra
                                parentesi si legge come "non ancora" senza
                                bisogno di spiegazioni, e non ruba larghezza. */}
                            {s.preso
                              ? s.preso.prezzo
                              : s.scelto
                                ? `(${s.scelto.prezzo})`
                                : consigli && s.obiettivo
                                  ? `(${s.obiettivo.prezzo})`
                                  : ""}
                          </span>
                          <span className="shrink-0 text-right" style={{ width: "2.1rem" }}>
                            {consigli && !s.preso && (s.scelto ?? s.obiettivo) && (
                              <span
                                className="num text-[0.58rem]"
                                style={{ color: coloreProbabilita((s.scelto ?? s.obiettivo)!.probabilita) }}
                                title={
                                  s.scelto
                                    ? "Che probabilità hai di prenderlo al prezzo che hai messo tu"
                                    : (s.obiettivo?.probabilita ?? 0) >= 0.99
                                      ? "A quel prezzo nessun avversario può superarti"
                                      : "Quante probabilità hai di prenderlo davvero"
                                }
                              >
                                {Math.round((s.scelto ?? s.obiettivo)!.probabilita * 100)}%
                              </span>
                            )}
                          </span>
                          <span
                            className="flex shrink-0 items-center justify-end gap-1"
                            style={{ width: "1.9rem" }}
                          >
                            {modifica && s.scelto && (
                              <button
                                className="text-[var(--text-faint)] hover:text-[var(--danger)]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removePin(s.scelto!.playerId);
                                }}
                                title="Togli questa scelta"
                              >
                                <IconaCroce size={11} />
                              </button>
                            )}
                            {/* Un'icona sola invece della parola "scegli"
                                ripetuta venticinque volte: la riga intera e'
                                gia' cliccabile, e la matita serve solo a farlo
                                capire. */}
                            {modificabile && (
                              <span className="text-[var(--text-faint)]">
                                <IconaMatita />
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {/* Il conto che mancava: quanto vale la rosa **intera** — comprati,
              scelti a mano e obiettivi insieme — contro il budget di partenza.
              Prima si vedeva solo quanto impegnava il piano sui crediti
              residui, e con una scelta a mano sballata i numeri non tornavano
              e non si capiva da dove. */}
          <div className="mt-2 border-t border-[var(--border)] pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="label-xs">Valore della rosa</span>
              <span className="num text-xs font-bold" style={{ color: coloreTotale }}>
                {valoreRosa}
                <span className="font-normal text-[var(--text-faint)]">
                  /{me.participant.budget_total}
                </span>
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6rem] text-[var(--text-faint)]">
              <span>
                comprati <span className="num">{me.spent}</span>
              </span>
              {scelti > 0 && (
                <span style={{ color: "var(--info)" }}>
                  scelti da te <span className="num">{scelti}</span>
                </span>
              )}
              {consigli && (
                <span>
                  proposti <span className="num">{Math.max(0, piano.impegnati - scelti)}</span>
                </span>
              )}
              <span>
                liberi <span className="num">{me.participant.budget_total - valoreRosa}</span>
              </span>
            </div>
            {sforato > 0 && (
              <p className="mt-1.5 text-[0.62rem] leading-relaxed" style={{ color: "var(--danger)" }}>
                Le tue scelte sfondano il budget di <span className="num">{sforato}</span> crediti:
                togline una o abbassa un prezzo.
              </p>
            )}
            {consigli && sforato === 0 && (
              <p className="mt-1.5 text-[0.6rem] leading-relaxed text-[var(--text-faint)]">
                Uno slot da un credito, adesso, rende{" "}
                <span className="num">{piano.valoreDiUnCredito}</span>.
              </p>
            )}
          </div>

          {/* Il tasto sta in fondo, dove finisce la rosa: e' la cosa che si fa
              **dopo** averla guardata, non prima. */}
          <div className="mt-3 border-t border-[var(--border)] pt-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`btn btn-sm ${modifica ? "btn-primary" : ""}`}
                onClick={() => {
                  setModifica((x) => !x);
                  setRigaAperta(null);
                }}
              >
                {modifica ? "Ho finito" : "Scegli tu"}
              </button>
              {pins.length > 0 && (
                <button className="btn btn-sm" onClick={() => void clearPins()}>
                  Azzera le {pins.length} scelte
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[0.6rem] leading-relaxed text-[var(--text-faint)]">
              {modifica
                ? "Tocca una riga per dire chi ci vuoi e a quanto. Quello che scegli resta fermo, e il resto della rosa si ricostruisce intorno con i crediti che avanzano."
                : "Metti tu un giocatore in una riga, col prezzo che sei disposto a pagare: resta lì finché non lo togli, e il piano si adatta."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Scegliere chi va in questo slot, digitando sulla riga.
 *
 * Prima c'era un riquadro a parte in cima al pannello: si cercava li' e il
 * giocatore finiva in un posto qualsiasi della rosa. Ma la domanda che uno si
 * fa all'asta non e' "chi voglio", e' **"chi ci metto qui"** — sulla riga del
 * secondo attaccante, o del terzo difensore. Cosi' la riga stessa diventa il
 * campo, e il prezzo si scrive di fianco.
 *
 * Il ruolo lo decide la riga: cercando dallo slot dei portieri escono solo
 * portieri, che e' l'unico comportamento sensato quando stai riempendo un
 * reparto.
 */
function SceltaSullaRiga({
  role,
  suggerito,
  crediti,
  slotsLiberi,
  altreScelte,
  altrove,
  onAdd,
  onAnnulla,
}: {
  role: Role;
  suggerito: number | null;
  crediti: number;
  slotsLiberi: number;
  /** Le altre scelte a mano gia' in piano: occupano crediti e slot anche loro. */
  altreScelte: number[];
  /** Se quel giocatore e' gia' scelto in un'altra riga, a quanto. */
  altrove: (playerId: string) => number | null;
  onAdd: (playerId: string, prezzo: number) => Promise<{ error?: string }>;
  onAnnulla: () => void;
}) {
  const { players, state, valuations } = useLeague();
  const [query, setQuery] = useState("");
  const [scelto, setScelto] = useState<string | null>(null);
  const [prezzo, setPrezzo] = useState(suggerito != null ? String(suggerito) : "");
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confermaDoppio, setConfermaDoppio] = useState(false);

  const indice = useMemo(
    () =>
      new Map(
        players
          .filter((p) => p.role === role)
          .map((p) => [
            p.id,
            indicizza({ id: p.id, name: p.name, team: p.team, fullName: p.identity?.full_name }),
          ]),
      ),
    [players, role],
  );

  const risultati = useMemo(() => {
    const parole = paroleDi(query);
    if (parole.length === 0) return [];
    return players
      .filter((p) => p.role === role && !state.takenPlayerIds.has(p.id))
      .map((p) => ({ p, s: indice.get(p.id) ? punteggio(indice.get(p.id)!, parole) : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.p);
  }, [players, role, query, indice, state.takenPlayerIds]);

  const giocatore = scelto ? players.find((p) => p.id === scelto) ?? null : null;
  const giaAltrove = giocatore ? altrove(giocatore.id) : null;

  /**
   * Un piano deve poter essere eseguito.
   *
   * Senza questo si poteva scrivere Kean a 450 con 455 crediti e ventiquattro
   * slot da riempire: il pannello lo accettava e mostrava una rosa da 480
   * crediti su 455. Non era una pianificazione, era un numero impossibile.
   */
  const impossibile =
    giocatore && prezzo !== ""
      ? perchePianoImpossibile({
          crediti,
          slotsLiberi,
          altreScelte,
          prezzo: Number(prezzo) || 0,
          nome: giocatore.name,
        })
      : null;

  async function conferma(id: string, n: number) {
    if (impossibile) {
      setErrore(impossibile);
      return;
    }
    // Sostituire in silenzio una scelta gia' fatta e' il modo piu' rapido di
    // perderla: il giocatore sparisce da una riga e ricompare in un'altra, e chi
    // guarda non sa cosa e' successo.
    const gia = altrove(id);
    if (gia && !confermaDoppio) {
      setConfermaDoppio(true);
      return;
    }
    setBusy(true);
    const res = await onAdd(id, n);
    setBusy(false);
    if (res.error) setErrore(res.error);
  }

  return (
    <span className="relative min-w-0 flex-1">
      <span className="flex items-center gap-1">
        {giocatore ? (
          // Il nome scelto resta un tasto: prima diventava testo fisso e per
          // cambiare giocatore bisognava annullare tutto e ricominciare.
          <button
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[0.68rem] font-medium hover:text-[var(--accent)]"
            onClick={() => {
              setScelto(null);
              setQuery(giocatore.name);
              setErrore(null);
            }}
            title="Cambia giocatore"
          >
            <span className="truncate">{giocatore.name}</span>
            <span className="shrink-0 text-[var(--text-faint)]">
              <IconaMatita size={10} />
            </span>
          </button>
        ) : (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="chi ci metti?"
            className="min-w-0 flex-1 text-[0.68rem]"
            style={{ padding: "0.1rem 0.35rem", height: "1.4rem" }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onAnnulla();
              if (e.key === "Enter" && risultati[0]) {
                setScelto(risultati[0].id);
                if (!prezzo) {
                  const v = valuations.byPlayer.get(risultati[0].id);
                  setPrezzo(String(Math.max(1, Math.round(v?.baseValue ?? 1))));
                }
              }
            }}
          />
        )}
        <input
          value={prezzo}
          onChange={(e) => setPrezzo(e.target.value)}
          inputMode="numeric"
          placeholder="cr"
          className="num shrink-0 text-[0.68rem]"
          style={{ width: "3rem", padding: "0.1rem 0.3rem", height: "1.4rem" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onAnnulla();
            if (e.key === "Enter" && giocatore) {
              const n = Number(prezzo);
              if (Number.isFinite(n) && n >= 1) void conferma(giocatore.id, n);
            }
          }}
        />
        <button
          className="shrink-0 text-[var(--accent)] disabled:opacity-40"
          disabled={busy || !giocatore || !!impossibile}
          onClick={() => {
            const n = Number(prezzo);
            if (!giocatore) return;
            if (!Number.isFinite(n) || n < 1) {
              setErrore("Manca il prezzo.");
              return;
            }
            void conferma(giocatore.id, n);
          }}
          title="Metti questo giocatore nel piano"
        >
          <IconaSpunta />
        </button>
        <button
          className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text)]"
          onClick={onAnnulla}
          title="Lascia perdere"
        >
          <IconaCroce />
        </button>
      </span>

      {!giocatore && risultati.length > 0 && (
        <span className="absolute left-0 right-0 top-[1.5rem] z-20 block rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 shadow-lg">
          {risultati.map((p) => {
            const v = valuations.byPlayer.get(p.id);
            return (
              <button
                key={p.id}
                className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-[0.66rem] hover:bg-[var(--bg)]"
                onClick={() => {
                  setScelto(p.id);
                  setErrore(null);
                  if (!prezzo) setPrezzo(String(Math.max(1, Math.round(v?.baseValue ?? 1))));
                }}
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-[0.6rem] text-[var(--text-faint)]">{p.team}</span>
                {v && (
                  <span className="num shrink-0 text-[0.6rem]" style={{ color: "var(--accent)" }}>
                    {Math.round(v.baseValue)}
                  </span>
                )}
              </button>
            );
          })}
        </span>
      )}
      {giaAltrove && confermaDoppio && !errore && !impossibile && (
        <span className="absolute left-0 right-0 top-[1.6rem] z-20 block rounded-md border border-[var(--warn)] bg-[var(--bg-elevated)] px-1.5 py-1 text-[0.6rem] leading-snug shadow-lg">
          <span style={{ color: "var(--warn)" }}>
            {giocatore?.name} è già nel tuo piano a {giaAltrove} crediti.
          </span>{" "}
          <span className="text-[var(--text-muted)]">Lo sposti qui? Premi di nuovo ✓.</span>
        </span>
      )}
      {(errore || impossibile) && (
        <span className="absolute left-0 right-0 top-[1.6rem] z-20 block rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-1.5 py-1 text-[0.6rem] leading-snug text-[var(--danger)] shadow-lg">
          {errore ?? impossibile}
        </span>
      )}
    </span>
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
export default memo(RosaIdeale);
