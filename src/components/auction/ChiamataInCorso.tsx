"use client";

import { memo, useEffect, useMemo, useState } from "react";

import { useLeague } from "@/components/LeagueDataProvider";
import { Aiuto, IconaCroce, IconaSpunta, RoleBadge } from "@/components/ui";
import { perchePrezzoImpossibile } from "@/lib/fanta/market";
import { indicizza, paroleDi, punteggio } from "@/lib/fanta/ricerca";
import { conConsigli } from "@/lib/livelli";

/**
 * La chiamata in corso, uguale su tutti gli schermi della lega.
 *
 * Durante una chiamata la cosa che cambia di continuo e' **a quanto siamo e chi
 * sta davanti**, ed e' l'unica informazione che tutti guardano nello stesso
 * momento. Prima viveva sui fogli di ognuno: chi registrava alla fine doveva
 * ricordarsela, e bastava una distrazione per scrivere la cifra sbagliata.
 *
 * Chi conduce — un premium o un amministratore — batte i rilanci; tutti gli
 * altri li vedono comparire. Non e' una limitazione ma la stessa regola
 * dell'asta vera: il banditore e' uno.
 */
function ChiamataInCorso({ unita = false }: { unita?: boolean }) {
  /** La cifra mentre la stai battendo: finche' e' `null`, comanda la lega. */
  const [scritto, setScritto] = useState<string | null>(null);
  /** Aperto solo quando chi conduce dice "non e' lui": e' una correzione, non una ricerca. */
  const [cambio, setCambio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const {
    league,
    giocatoriInAsta,
    events,
    puntate,
    recordEvent,
    playerMap,
    valuations,
    participants,
    state,
    livello,
    setOffertaCorrente,
    setGiocatoreInAsta,
    setChiamataConfermata,
  } = useLeague();
  const conduce = conConsigli(livello);

  const player = league.current_player_id ? playerMap.get(league.current_player_id) : null;

  /**
   * Un orologio lento, solo per far scadere il ponte.
   *
   * Senza, se il ponte si spegne la pagina non se ne accorge: nessun dato
   * cambia, quindi React non ridisegna, e i comandi resterebbero nascosti
   * finche' non si tocca qualcosa.
   */
  const [adesso, setAdesso] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAdesso(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  /**
   * Il ponte e' vivo se si e' fatto sentire da poco.
   *
   * Non basta che esista un segreto: uno spento ieri lascerebbe l'asta senza
   * comandi per sempre. Il ponte batte almeno ogni venti secondi, quindi
   * quaranta di tolleranza distinguono "acceso" da "spento" senza falsi
   * allarmi se una chiamata si perde.
   */
  const battito = league.bridge_seen_at ? Date.parse(league.bridge_seen_at) : 0;
  const ponteAcceso = battito > 0 && adesso - battito < 40_000;



  const indice = useMemo(
    () =>
      new Map(
        giocatoriInAsta.map((p) => [
          p.id,
          indicizza({ id: p.id, name: p.name, team: p.team, fullName: p.identity?.full_name }),
        ]),
      ),
    [giocatoriInAsta],
  );
  const trovati = useMemo(() => {
    const q = (cambio ?? "").trim();
    if (q.length < 2) return [];
    const parole = paroleDi(q);
    return giocatoriInAsta
      .filter((p) => p.id !== league.current_player_id && !state.takenPlayerIds.has(p.id))
      .map((p) => ({ p, s: punteggio(indice.get(p.id) ?? { id: p.id, parole: [], squadra: [] }, parole) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.p);
  }, [cambio, giocatoriInAsta, indice, league.current_player_id, state.takenPlayerIds]);

  if (!player) return null;

  const prezzo = league.current_price ?? 0;
  const confermata = league.current_locked === true;
  const chi = league.current_bidder
    ? participants.find((p) => p.id === league.current_bidder)
    : null;
  const v = valuations.byPlayer.get(player.id);

  // Chi non puo' piu' salire: la cifra sul piatto e' gia' oltre quello che
  // gli resterebbe per completare la rosa. Serve a chi conduce per sapere
  // quando la chiamata e' di fatto finita.
  const ancoraInGara = state.teams.filter(
    (t) =>
      t.slotsLeft[player.role] > 0 &&
      !perchePrezzoImpossibile({
        state,
        participantId: t.participant.id,
        price: prezzo + 1,
        role: player.role,
      }),
  );

  const rilancia = (a: number) => void setOffertaCorrente(Math.max(1, prezzo + a), league.current_bidder ?? null);

  /**
   * Cambiare giocatore a chiamata aperta: si corregge il **nome**, non l'asta.
   *
   * La cifra e chi e' davanti restano dov'erano. Il caso vero e' che il
   * microfono abbia capito Carnesecchi mentre chiamavano Caprile: in stanza si
   * e' gia' arrivati a quaranta, e ricominciare da zero vorrebbe dire buttare
   * l'unica cosa che era giusta. Alla fine si riconferma da sola, perche'
   * sceglierlo a mano *e'* la conferma.
   */
  async function cambiaGiocatore(id: string) {
    const primaPrezzo = league.current_price;
    const primaChi = league.current_bidder ?? null;
    setErrore(null);
    if (confermata) {
      const r = await setChiamataConfermata(false);
      if (r.error) return setErrore(r.error);
    }
    const r = await setGiocatoreInAsta(id);
    if (r.error) return setErrore(r.error);
    if (primaPrezzo != null) await setOffertaCorrente(primaPrezzo, primaChi);
    await setChiamataConfermata(true);
    setCambio(null);
  }

  /**
   * Registrare e' chiudere.
   *
   * La cifra e chi e' davanti sono quelli sulla barra: non si ridigitano, si
   * confermano. `recordEvent` chiude la chiamata su tutti gli schermi, quindi
   * un solo gesto fa finire l'asta di questo giocatore per tutta la lega.
   */
  // Catturato qui: dentro la funzione di registrazione TypeScript perderebbe
  // il restringimento fatto dal `return null` piu' sopra.
  const idGiocatore = player.id;
  const gia = events.find((e) => e.player_id === idGiocatore) ?? null;
  const impossibile = perchePrezzoImpossibile({
    state,
    participantId: league.current_bidder ?? null,
    price: prezzo,
    role: player.role,
    precedente: gia ? { participantId: gia.participant_id, price: gia.price } : null,
  });
  const puoRegistrare = prezzo > 0 && !!league.current_bidder && !impossibile;
  const perche =
    impossibile ??
    (prezzo <= 0
      ? "Metti la cifra a cui e' stato aggiudicato."
      : !league.current_bidder
        ? "Dì a chi è andato: senza, non si può registrare."
        : null);

  async function registra(esito: "assigned" | "unsold") {
    setOccupato(true);
    setErrore(null);
    const res = await recordEvent({
      playerId: idGiocatore,
      participantId: esito === "unsold" ? null : (league.current_bidder ?? null),
      price: esito === "unsold" ? 0 : prezzo,
      outcome: esito,
    });
    setOccupato(false);
    if (res.error) setErrore(res.error);
  }

  return (
    <div
      className={`panel shrink-0 overflow-hidden ${unita ? "rounded-b-none" : ""}`}
      style={{
        borderColor: confermata ? "var(--accent)" : "var(--accent-dim)",
        // Opaco, non trasparente: quando la barra resta fissata in cima, la
        // scheda che le scorre sotto non deve trasparire attraverso.
        background: "color-mix(in srgb, var(--accent) 5%, var(--bg))",
      }}
    >
      {/* Il nome grande e' il punto.
          Durante una chiamata la stanza urla, il banditore conta, e la domanda
          e' sempre la stessa: chi e', e a quanto siamo. Prima erano due righe
          fitte in mezzo ad altri riquadri; adesso e' la cosa piu' grossa dello
          schermo, e il resto sta a fianco. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-3.5 pb-2.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="label-xs whitespace-nowrap" style={{ color: "var(--accent)" }}>
              In asta adesso
            </span>
            <RoleBadge role={player.role} size="sm" />
            {confermata ? (
              <span className="chip" style={{ color: "var(--accent)", borderColor: "var(--accent-dim)" }}>
                confermato
              </span>
            ) : (
              <span className="chip" style={{ color: "var(--warn)" }}>
                da confermare
              </span>
            )}
            {/* La spiegazione della conferma si legge una volta sola: da li' in
                poi e' una riga di testo che ruba spazio a ogni chiamata. */}
            <Aiuto largo={18}>
              {confermata
                ? "Il nome è bloccato fino a chiamata chiusa: il microfono ora può solo far salire la cifra. Per cambiarlo c'è «non è lui»."
                : "Finché non confermi, quello che sente il microfono può ancora cambiare il nome sul piatto."}
            </Aiuto>
          </div>
          <div className="mt-0.5 truncate text-2xl font-bold leading-tight tracking-tight">
            {player.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 text-[0.68rem] text-[var(--text-faint)]">
            <span>{player.team}</span>
            {player.quotation_current != null && (
              <span className="num">
                quotazione <span className="text-[var(--text-muted)]">{player.quotation_current}</span>
              </span>
            )}
            {v && conduce && (
              <span className="num" style={{ color: "var(--accent)" }}>
                vale {Math.round(v.baseValue)}
              </span>
            )}
          </div>
        </div>

        {/* L'offerta: la cifra e chi l'ha fatta, insieme. Una cifra senza un
            nome accanto non dice se sei tu a essere davanti. */}
        <div className="shrink-0 text-right">
          <div className="num text-4xl font-bold leading-none" style={{ color: prezzo ? "var(--text)" : "var(--text-faint)" }}>
            {prezzo || "—"}
          </div>
          <div className="mt-1 text-[0.72rem] leading-tight">
            {chi ? (
              <span style={{ color: chi.id === state.me?.participant.id ? "var(--accent)" : "var(--warn)" }}>
                rilancio di <strong>{chi.name}</strong>
              </span>
            ) : (
              <span className="text-[var(--text-faint)]">
                {prezzo ? "nessuno dichiarato" : "nessuna offerta"}
              </span>
            )}
          </div>
        </div>
      </div>

      {conduce && (
        <div className="border-t border-[var(--border)] px-3.5 py-2">
          {/* Una riga per la cifra, una per cosa farne. Erano quattro, e in
              mezzo c'erano tre frasi di spiegazione: su uno schermo dove la
              cosa importante e' il nome grande, le spiegazioni le tiene la ⓘ. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* La cifra si batte, non si costruisce a colpi di +1: il banditore
                dice "centocinquanta" e chi conduce la scrive. Il campo si
                aggiorna da solo quando la cifra arriva da qualcun altro o dal
                microfono, ma smette mentre lo stai scrivendo. */}
            <input
              value={scritto ?? (prezzo || "")}
              onChange={(e) => setScritto(e.target.value.replace(/[^0-9]/g, ""))}
              onFocus={() => setScritto(prezzo ? String(prezzo) : "")}
              onBlur={() => {
                const n = Number(scritto);
                if (scritto !== null && Number.isFinite(n) && n >= 1 && n !== prezzo) {
                  void setOffertaCorrente(n, league.current_bidder ?? null);
                }
                setScritto(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setScritto(null);
              }}
              inputMode="numeric"
              placeholder="cifra"
              className="num shrink-0 px-2 py-1 text-center text-sm font-bold"
              style={{ width: "4.2rem" }}
              aria-label="A quanto siamo"
            />
            <select
              value={league.current_bidder ?? ""}
              onChange={(e) => void setOffertaCorrente(Math.max(1, prezzo), e.target.value || null)}
              className="min-w-0 flex-1 py-1 text-sm"
              style={{ minWidth: "8rem", maxWidth: "11rem" }}
            >
              <option value="">chi sta offrendo?</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex shrink-0 gap-1">
              {[1, 5, 10].map((a) => (
                <button key={a} className="btn btn-sm" onClick={() => rilancia(a)}>
                  +{a}
                </button>
              ))}
              <button className="btn btn-sm" onClick={() => rilancia(-1)} title="Correggi in giù">
                −1
              </button>
            </div>
            {prezzo > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.62rem] text-[var(--text-faint)]">
                {ancoraInGara.length === 0 ? (
                  <>a questa cifra è suo</>
                ) : (
                  <>
                    <span className="num">{ancoraInGara.length}</span> possono rilanciare
                  </>
                )}
                <Aiuto largo={15}>
                  {ancoraInGara.length === 0
                    ? "Nessun altro può arrivare a questa cifra e completare la rosa: a questo prezzo è suo."
                    : `Possono ancora rilanciare: ${ancoraInGara.map((t) => t.participant.name).join(", ")}.`}
                </Aiuto>
              </span>
            )}
          </div>

          {/* ----------------------------------------- com'e' finita, in riga
              Prezzo e acquirente sono gia' qui sopra, li hanno appena visti
              tutti: chiudere la chiamata e registrarla sono la stessa cosa.

              Col ponte acceso questi comandi non ci sono: comanda il
              tabellone, e registrare di qua mentre l'asta va avanti di la'
              farebbe divergere le due rose — un guaio che si scopre a fine
              asta, quando non si rimedia piu'. */}
          {/* La storia dei rilanci di questa chiamata: serve a capire se il
              prezzo sta correndo o si e' fermato, che e' la domanda vera
              quando si decide se rilanciare ancora. */}
          {puntate.length > 1 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[0.62rem] text-[var(--text-faint)]">
              <span className="label-xs">rilanci</span>
              {puntate.map((x, i) => (
                <span
                  key={`${x.prezzo}-${i}`}
                  className="chip"
                  style={
                    i === puntate.length - 1
                      ? { borderColor: "var(--accent)", color: "var(--accent)" }
                      : undefined
                  }
                >
                  <span className="num">{x.prezzo}</span>
                  {x.chi && (
                    <span className="ml-1 normal-case">
                      {participants.find((p) => p.id === x.chi)?.name ?? ""}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}

          {ponteAcceso ? (
            <div
              className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.68rem]"
              style={{ color: "var(--text-faint)" }}
            >
              <span className="chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                ponte acceso
              </span>
              Comanda il tabellone: chiamata e aggiudicazioni arrivano da FantaAstaLive, e qui non si
              registra a mano.
              <Aiuto largo={17}>
                Il ponte legge il tabellone e registra lui gli acquisti. Se aggiudicassi da qui, di
                là non lo saprebbe nessuno e le due rose si separerebbero. Per tornare a registrare
                a mano, spegni il ponte cliccando il suo riquadro sul tabellone: dopo mezzo minuto i
                comandi ricompaiono.
              </Aiuto>
            </div>
          ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!confermata && (
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  setErrore(null);
                  const r = await setChiamataConfermata(true);
                  if (r.error) setErrore(r.error);
                }}
              >
                <span className="mr-1 inline-block align-[-2px]">
                  <IconaSpunta />
                </span>
                È lui
              </button>
            )}
            <button
              className={`btn btn-sm ${confermata ? "btn-primary" : ""}`}
              disabled={occupato || !puoRegistrare}
              onClick={() => void registra("assigned")}
              title={perche ?? undefined}
            >
              {chi && prezzo > 0 ? `Aggiudica a ${chi.name} per ${prezzo}` : "Aggiudica"}
            </button>
            <button className="btn btn-sm" disabled={occupato} onClick={() => void registra("unsold")}>
              Non venduto
            </button>
            <button
              className="btn btn-sm"
              disabled={occupato}
              onClick={() => void setGiocatoreInAsta(null)}
              title="Toglie il giocatore dal piatto per tutta la lega senza registrare niente"
            >
              Annulla
            </button>
            {confermata && cambio === null && (
              <button className="btn btn-sm" onClick={() => setCambio("")}>
                Non è lui
              </button>
            )}
            {perche && (
              <span
                className="ml-auto text-[0.62rem] leading-tight"
                style={{ color: impossibile ? "var(--warn)" : "var(--text-faint)" }}
              >
                {perche}
              </span>
            )}
          </div>
          )}

          {/* La ricerca per correggere il nome compare solo quando serve. */}
          {cambio !== null && (
            <div className="mt-1.5">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={cambio}
                  onChange={(e) => setCambio(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setCambio(null);
                    if (e.key === "Enter" && trovati[0]) void cambiaGiocatore(trovati[0].id);
                  }}
                  placeholder="chi stanno chiamando davvero?"
                  className="min-w-0 flex-1 py-1 text-sm"
                  autoComplete="off"
                />
                <button className="btn btn-sm" onClick={() => setCambio(null)} title="Lascia com'è">
                  <IconaCroce />
                </button>
                <Aiuto largo={16}>
                  La cifra e chi è davanti restano dove sono: qui si corregge solo il nome.
                </Aiuto>
              </div>
              {trovati.length > 0 && (
                <ul className="mt-1 divide-y divide-[var(--border)]">
                  {trovati.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => void cambiaGiocatore(p.id)}
                        className="flex w-full items-center gap-2 px-1 py-1.5 text-left hover:bg-[var(--bg-elevated)]"
                      >
                        <RoleBadge role={p.role} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                        <span className="shrink-0 text-[0.68rem] text-[var(--text-faint)]">
                          {p.team}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {errore && (
            <p className="mt-1.5 text-[0.68rem]" style={{ color: "var(--danger)" }}>
              {errore}
            </p>
          )}
        </div>
      )}

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
export default memo(ChiamataInCorso);
