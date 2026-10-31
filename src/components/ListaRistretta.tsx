"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AgganciaSquadre from "@/components/AgganciaSquadre";
import { RoleBadge } from "@/components/ui";
import { ROLES, ROLE_LABEL_SHORT, type Role, type RoleMap } from "@/lib/fanta/types";

type Giocatore = { id: string; name: string; team: string; role: Role; quotation_current: number | null };

/**
 * La lista dei chiamabili: guardarla, scaricarla, ricaricarla.
 *
 * Tre gesti e nient'altro, perche' il lavoro vero si fa in Excel — e' li' che
 * si discute in otto, si cancella una riga e se ne aggiunge un'altra. Il
 * software propone e poi **obbedisce**: quello che torna dal file e' la lista,
 * senza fondersi con la precedente, perche' "aggiungi" lascerebbe dentro chi
 * qualcuno aveva appena tolto.
 */
export default function ListaRistretta({
  leagueId,
  season,
  squadre,
  slots,
  budget,
  puoScrivere,
  conConsigli,
  astaIniziata,
}: {
  leagueId: string;
  season: string;
  /** Le squadre della lega, non quelle iscritte: a un'asta di otto ci si va in otto. */
  squadre: number;
  slots: RoleMap<number>;
  budget: number;
  puoScrivere: boolean;
  conConsigli: boolean;
  astaIniziata: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [giocatori, setGiocatori] = useState<Giocatore[]>([]);
  const [lista, setLista] = useState<Set<string>>(new Set());
  const [caricando, setCaricando] = useState(true);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  /** Quanti in piu' dei necessari: la lista al minimo e' un'asta senza scelte. */
  const [extra, setExtra] = useState(35);
  const [cerca, setCerca] = useState("");
  /** Se il tabellone deve ordinare i giocatori per il nostro valore invece che per il FVM. */
  const [falNostroFvm, setFalNostroFvm] = useState(false);
  /** Il preferito del ponte, quando l'amministratore lo chiede. */
  const [ponte, setPonte] = useState<string | null>(null);
  /** Se la riga del ponte e' appena finita negli appunti: un riscontro, non un avviso. */
  const [copiato, setCopiato] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [{ data: players }, { data: righe }] = await Promise.all([
        supabase
          .from("players")
          .select("id, name, team, role, quotation_current")
          .eq("season", season)
          .eq("is_active", true),
        supabase.from("league_shortlist").select("player_id").eq("league_id", leagueId),
      ]);
      if (!vivo) return;
      setGiocatori((players ?? []) as Giocatore[]);
      setLista(new Set((righe ?? []).map((r) => r.player_id as string)));
      setCaricando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, leagueId, season]);

  const perRuolo = useMemo(() => {
    const dentro = giocatori.filter((g) => lista.has(g.id));
    const mappa = new Map<Role, Giocatore[]>();
    for (const r of ROLES) {
      mappa.set(
        r,
        dentro
          .filter((g) => g.role === r)
          .sort((a, b) => Number(b.quotation_current ?? 0) - Number(a.quotation_current ?? 0)),
      );
    }
    return mappa;
  }, [giocatori, lista]);

  async function scarica() {
    setOccupato(true);
    setErrore(null);
    try {
      const res = await fetch(`/api/lega/${leagueId}/lista?formato=xlsx&extra=${extra / 100}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Non sono riuscito a preparare il file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lista-asta-${season}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMessaggio("Proposta scaricata: aprila in Excel, taglia chi non vuoi e ricaricala.");
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function carica(file: File) {
    setOccupato(true);
    setErrore(null);
    setMessaggio(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/lega/${leagueId}/lista`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Caricamento fallito");
      const { data: righe } = await supabase
        .from("league_shortlist")
        .select("player_id")
        .eq("league_id", leagueId);
      setLista(new Set((righe ?? []).map((r) => r.player_id as string)));
      // Il csv per il tabellone esce dallo stesso gesto.
      //
      // Sono due meta' della stessa operazione: la lista si decide in Excel e
      // si carica qui, e il file che la porta di la' contiene esattamente
      // quella. Lasciarli su due pulsanti separati vuol dire che un giorno si
      // carica la lista, ci si dimentica il secondo clic, e il tabellone resta
      // con i cinquecento di prima — cioe' chiamabili giocatori che la lega ha
      // appena escluso.
      const nota = await scaricaFAL("lista");
      setMessaggio(
        `Lista aggiornata: ${j.salvati} giocatori chiamabili. Ti ho scaricato anche il csv da caricare su FantaAstaLive.` +
          (j.avvisi?.length ? ` ${j.avvisi.join(" ")}` : "") +
          (nota ? ` ${nota}` : ""),
      );
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function azzera() {
    setOccupato(true);
    await fetch(`/api/lega/${leagueId}/lista`, { method: "DELETE" });
    setLista(new Set());
    setMessaggio("Lista tolta: torna chiamabile tutto il listone.");
    setOccupato(false);
  }

  /**
   * Un file per FantaAstaLive: la lista calciatori, le squadre o le rose.
   *
   * Restituisce il resoconto invece di scriverlo: chi la chiama dopo un
   * caricamento vuole dire una frase sola, non due messaggi che si
   * sovrascrivono a vicenda.
   */
  async function scaricaFAL(cosa: "lista" | "squadre" | "rose"): Promise<string> {
    setOccupato(true);
    setErrore(null);
    try {
      const q = cosa === "lista" && falNostroFvm ? "&fvm=nostro" : "";
      const res = await fetch(`/api/lega/${leagueId}/fantaastalive?cosa=${cosa}${q}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Non sono riuscito a preparare il file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        cosa === "lista"
          ? `lista-calciatori-${season}.csv`
          : cosa === "squadre"
            ? `squadre-${season}.sav`
            : `rose-${season}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      // Il formato delle rose ricava le squadre dalle righe dei giocatori: chi
      // non ha ancora comprato nessuno non entra nel file. Meglio saperlo qui
      // che vedere una squadra sparire dal tabellone dopo averlo caricato.
      const saltate = res.headers.get("x-squadre-saltate");
      return saltate
        ? `Nel file non ci sono ${decodeURIComponent(saltate)}: non hanno ancora comprato nessuno, e questo formato non sa scrivere una rosa vuota. Per crearle di là usa «Squadre».`
        : "";
    } catch (e) {
      setErrore((e as Error).message);
      return "";
    } finally {
      setOccupato(false);
    }
  }

  /** Il ponte: genera il segreto e mette il preferito negli appunti. */
  async function accendiPonte(rigenera: boolean) {
    setOccupato(true);
    setErrore(null);
    setMessaggio(null);
    try {
      const res = await fetch(
        `/api/lega/${leagueId}/fantaastalive?cosa=ponte${rigenera ? "&rigenera=1" : ""}`,
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Non sono riuscito a preparare il ponte");
      setPonte(j.preferito as string);
      setMessaggio(
        rigenera
          ? "Segreto rigenerato: il ponte acceso altrove ora è spento, reinstalla il preferito."
          : "Preferito pronto qui sotto.",
      );
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  /**
   * La riga del ponte negli appunti.
   *
   * E' lunga diecimila caratteri: selezionarla a mano in un riquadro alto
   * quattro righe e' un modo di sbagliare. Se gli appunti non si lasciano
   * scrivere — succede fuori da https — resta la selezione, che almeno mette
   * tutto in evidenza.
   */
  async function copiaPonte() {
    if (!ponte) return;
    try {
      await navigator.clipboard.writeText(ponte);
      setCopiato(true);
      setTimeout(() => setCopiato(false), 2000);
    } catch {
      const campo = document.getElementById("riga-del-ponte") as HTMLTextAreaElement | null;
      campo?.select();
      setErrore("Gli appunti non si lasciano scrivere: la riga è selezionata, copiala a mano.");
    }
  }

  /** Le rose esportate dal tabellone tornano dentro la nostra asta. */
  async function caricaRoseFAL(file: File) {
    setOccupato(true);
    setErrore(null);
    setMessaggio(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/lega/${leagueId}/fantaastalive`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Caricamento fallito");
      const pezzi = [`${j.registrati} acquisti registrati`];
      if (j.gia > 0) pezzi.push(`${j.gia} c'erano già`);
      if (j.senzaGiocatore > 0) pezzi.push(`${j.senzaGiocatore} non nel listone`);
      if (j.squadreIgnote?.length) pezzi.push(`squadre non riconosciute: ${j.squadreIgnote.join(", ")}`);
      setMessaggio(pezzi.join(" · ") + ".");
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  const quanti = lista.size;
  const servono = ROLES.reduce((a, r) => a + (slots[r] ?? 0) * Math.max(1, squadre), 0);

  /** Aggiungerne uno solo, che e' l'unica cosa concessa ad asta iniziata. */
  const trovati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    if (q.length < 2) return [];
    return giocatori
      .filter((g) => !lista.has(g.id) && g.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [cerca, giocatori, lista]);

  async function aggiungi(id: string) {
    setOccupato(true);
    setErrore(null);
    const nuova = [...lista, id];
    const res = await fetch(`/api/lega/${leagueId}/lista`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerIds: nuova }),
    });
    const j = await res.json();
    if (!res.ok) setErrore(j.error ?? "Non sono riuscito ad aggiungerlo");
    else {
      setLista(new Set(nuova));
      setMessaggio(`Aggiunto: ora sono ${j.salvati} chiamabili.`);
      setCerca("");
    }
    setOccupato(false);
  }

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label-xs">In lista</div>
            <div className="num text-3xl font-bold" style={{ color: quanti ? "var(--accent)" : "var(--text-faint)" }}>
              {caricando ? "…" : quanti || "tutti"}
            </div>
          </div>
          <div className="text-xs leading-relaxed text-[var(--text-faint)]">
            {quanti === 0 ? (
              <>
                Nessuna lista: all&apos;asta può essere chiamato chiunque.
                <br />
                Per riempire {squadre} rose servono almeno{" "}
                <span className="num text-[var(--text-muted)]">{servono}</span> giocatori.
              </>
            ) : (
              <>
                Per riempire {squadre} rose ne servono almeno{" "}
                <span className="num text-[var(--text-muted)]">{servono}</span>:{" "}
                {quanti >= servono ? (
                  <span style={{ color: "var(--accent)" }}>la lista basta</span>
                ) : (
                  <span style={{ color: "var(--danger)" }}>
                    così qualcuno resterà con la rosa incompleta
                  </span>
                )}
                .
              </>
            )}
          </div>
          {/* Rifarla si puo' solo prima.
              Cambiare la lista mentre si compra vorrebbe dire cambiare le
              regole a meta' partita: chi ha speso trenta crediti su un
              difensore perche' dopo non ne restavano si ritroverebbe la fascia
              ripopolata. Dalla prima chiamata registrata in poi si puo' solo
              aggiungere qualcuno, uno per volta, e si vede. */}
          {puoScrivere && conConsigli && !astaIniziata && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[0.68rem] normal-case tracking-normal text-[var(--text-faint)]">
                extra
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={5}
                  value={extra}
                  onChange={(e) => setExtra(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                  className="num text-center text-xs"
                  style={{ width: "3.6rem" }}
                />
                %
              </label>
              <button className="btn btn-sm" onClick={scarica} disabled={occupato}>
                Scarica la proposta
              </button>
              <label className="btn btn-sm btn-primary cursor-pointer">
                Carica la lista
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void carica(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {quanti > 0 && (
                <button className="btn btn-sm" onClick={azzera} disabled={occupato}>
                  Togli la lista
                </button>
              )}
            </div>
          )}
        </div>
        {/* Ad asta iniziata: un giocatore per volta, e basta. */}
        {puoScrivere && conConsigli && astaIniziata && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <div className="label-xs mb-1.5">L&apos;asta è cominciata</div>
            <p className="mb-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
              La lista non si rifà a metà partita: chi ha pagato trenta crediti un difensore perché
              dopo non ne restavano si ritroverebbe la fascia ripopolata. Si può solo aggiungere
              qualcuno, uno per volta — e tutti lo vedono.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                placeholder="aggiungi un giocatore alla lista"
                className="min-w-0 flex-1 text-sm"
                style={{ maxWidth: "20rem" }}
                autoComplete="off"
              />
              {trovati.map((g) => (
                <button
                  key={g.id}
                  className="chip cursor-pointer"
                  disabled={occupato}
                  onClick={() => void aggiungi(g.id)}
                >
                  {g.name} <span className="text-[var(--text-faint)]">{g.team}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {puoScrivere && conConsigli && !astaIniziata && (
          <p className="mt-3 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
            Il file ha due fogli: <strong>Lista</strong> con la proposta del modello — i migliori per
            ruolo, quanti bastano a riempire tutte le rose con un margine — e{" "}
            <strong>Tutti i giocatori</strong> con il listone intero, per aggiungerne altri senza
            dover indovinare come si scrivono. Si toglie qualcuno scrivendo <strong>NO</strong> nella
            colonna «In lista» o cancellando la riga; si aggiunge copiando la riga dal secondo foglio
            e scrivendo <strong>SI</strong>. Al ritorno l&apos;abbinamento passa dall&apos;Id
            ufficiale, quindi un nome scritto storto non perde il giocatore.
            <br />
            La proposta non e&apos; la classifica dei piu&apos; forti: e&apos; l&apos;insieme che fa
            un&apos;asta che funziona — ogni squadra deve poter chiudere la rosa, la lista deve
            essere pagabile con i {budget * squadre} crediti in gioco, e servono anche i giocatori
            da un credito per le ultime caselle. L&apos;ordine dentro ogni ruolo e&apos; la resa
            attesa in formazione, cioe&apos; la fantamedia pesata per le partite che giocherà.
          </p>
        )}
        {messaggio && (
          <p className="mt-2 text-xs" style={{ color: "var(--accent)" }}>
            {messaggio}
          </p>
        )}
        {errore && (
          <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
            {errore}
          </p>
        )}
      </div>

      {/* Il ponte verso FantaAstaLive.
          Il tabellone di Fantacalcio.it non ha API: legge e scrive due CSV, e
          quelli sappiamo farli. Serve a chi proietta il tabellone in sala e
          tiene FantAsta sul portatile per i consigli. */}
      {puoScrivere && (
        <div className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto min-w-0" style={{ flex: "1 1 14rem", maxWidth: "26rem" }}>
              <div className="label-xs flex items-center gap-2">
                FantaAstaLive
                {/* Il tabellone sta su un altro dominio: da qui non lo si puo'
                    pilotare, ma almeno lo si apre senza andarlo a cercare. */}
                <a
                  href="https://fanta-asta-live.fantacalcio.it"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[0.62rem] normal-case tracking-normal"
                  style={{ color: "var(--accent)" }}
                >
                  apri il tabellone ↗
                </a>
              </div>
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
                Il tabellone di Fantacalcio.it legge solo <strong>.csv</strong>, non i file Excel
                ufficiali: è per questo che non si caricano. Questi sono già nel suo formato.
              </p>
            </div>
            {conConsigli && (
              // Un interruttore, non una casella: la regola globale su `label`
              // sta fuori da ogni layer e trasforma le caselle in blocchi
              // bianchi in mezzo alla riga dei pulsanti.
              <button
                className="chip cursor-pointer"
                aria-pressed={falNostroFvm}
                onClick={() => setFalNostroFvm(!falNostroFvm)}
                style={{
                  borderColor: falNostroFvm ? "var(--accent)" : "var(--border-strong)",
                  color: falNostroFvm ? "var(--accent)" : "var(--text-faint)",
                }}
              >
                {falNostroFvm ? "✓ " : ""}ordina per il nostro valore
              </button>
            )}
            {/* Il formato sta scritto sul pulsante: sono tre file diversi che
                entrano di la' da tre porte diverse, e scoprirlo a scaricamento
                fatto e' il modo peggiore. */}
            <button className="btn btn-sm" onClick={() => void (async () => setMessaggio(("Scaricato. " + (await scaricaFAL("lista"))).trim()))()} disabled={occupato}>
              Lista calciatori <span className="text-[var(--text-faint)]">.csv</span>
            </button>
            <button className="btn btn-sm" onClick={() => void (async () => setMessaggio(("Scaricato. " + (await scaricaFAL("squadre"))).trim()))()} disabled={occupato}>
              Squadre <span className="text-[var(--text-faint)]">.sav</span>
            </button>
            <button className="btn btn-sm" onClick={() => void (async () => setMessaggio(("Scaricato. " + (await scaricaFAL("rose"))).trim()))()} disabled={occupato}>
              Rose <span className="text-[var(--text-faint)]">.csv</span>
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void accendiPonte(false)}
              disabled={occupato}
            >
              Accendi il ponte
            </button>
            <label className="btn btn-sm cursor-pointer">
              Rileggi le rose
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void caricaRoseFAL(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {ponte && (
            <div className="mt-3 rounded border border-[var(--accent)] p-3">
              <div className="label-xs mb-1" style={{ color: "var(--accent)" }}>
                Il ponte
              </div>
              <p className="mb-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
                Copia tutta la riga qui sotto, poi su FantaAstaLive premi <strong>Cmd&nbsp;+&nbsp;D</strong>{" "}
                → <em>Altro…</em>, chiamalo <strong>Ponte</strong> e incolla la riga nel campo{" "}
                <strong>URL</strong>. Salvalo nella barra dei preferiti, torna sul tabellone e
                cliccalo: in basso a destra compare «ponte FantAsta: acceso». Da lì in poi il
                giocatore chiamato e gli acquisti arrivano qui da soli. Per spegnerlo, clicca quel
                riquadro.
              </p>
              <div className="flex items-start gap-2">
                <textarea
                  id="riga-del-ponte"
                  readOnly
                  value={ponte}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full font-mono text-[0.6rem]"
                  style={{ height: "4.5rem" }}
                />
                <button
                  className="btn btn-sm shrink-0"
                  onClick={() => void copiaPonte()}
                  style={
                    copiato
                      ? { borderColor: "var(--accent)", color: "var(--accent)" }
                      : undefined
                  }
                >
                  {copiato ? "✓ copiata" : "Copia"}
                </button>
              </div>
              <p className="mt-1 text-[0.62rem] text-[var(--text-faint)]">
                È un segreto: chi ha questa riga può dire alla lega chi è in asta e registrare
                acquisti.{" "}
                <button
                  className="underline"
                  onClick={() => void accendiPonte(true)}
                  disabled={occupato}
                >
                  Rigeneralo
                </button>{" "}
                per revocarlo.
              </p>
            </div>
          )}

          {/* L'aggancio delle squadre: sta in un componente suo perche' lo
              stesso avviso serve anche in mezzo all'asta, dove di questa
              pagina non c'e' traccia. */}
          <AgganciaSquadre leagueId={leagueId} puoScrivere={puoScrivere} />

          {/* Quattro riquadri invece di un paragrafo solo: sono quattro
              operazioni diverse, si fanno in momenti diversi, e in mezzo a un
              muro di testo non si trovava quella che serviva adesso. */}
          <div className="mt-3 grid gap-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)] sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-[var(--border)] p-2">
              <div className="label-xs mb-1">Lista calciatori · .csv</div>
              {quanti > 0 ? "I chiamabili della lista" : "Tutto il listone"}. Di là si carica dal
              pulsante della lista calciatori: da quel momento il tabellone mostra{" "}
              <em>Lista custom</em> e non chiede più di aggiornarsi.
            </div>
            <div className="rounded border border-[var(--border)] p-2">
              <div className="label-xs mb-1">Squadre · .sav</div>
              I {squadre} partecipanti coi loro nomi, anche prima che abbiano comprato qualcuno. È
              un file di salvataggio, non un csv: si carica da <em>Importa dati</em> nel menu del
              tabellone e tocca solo le squadre. Da fare una volta sola, prima di cominciare.
            </div>
            <div className="rounded border border-[var(--border)] p-2">
              <div className="label-xs mb-1">Rose · .csv</div>
              Gli acquisti già registrati qui. Si carica dal riquadro delle squadre con «Importa da
              file»: di là <em>sostituisce</em> squadre e assegnazioni, e chi non ha ancora comprato
              nessuno non c&apos;è — il formato ricava le squadre dalle righe dei giocatori, e una
              rosa vuota non ne produce.
            </div>
            <div className="rounded border border-[var(--border)] p-2">
              <div className="label-xs mb-1">Rileggi le rose</div>
              Il verso opposto: si esportano le rose da FantaAstaLive e si caricano qui. Si può
              rifare quante volte si vuole — quello che è già registrato non viene toccato — ma i
              nomi delle squadre devono essere gli stessi dei partecipanti.
            </div>
          </div>
        </div>
      )}

      {quanti > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ROLES.map((r) => {
            const dentro = perRuolo.get(r) ?? [];
            const necessari = (slots[r] ?? 0) * Math.max(1, squadre);
            return (
              <div key={r} className="panel">
                <header className="flex items-baseline justify-between border-b border-[var(--border)] px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <RoleBadge role={r} size="sm" />
                    <span className="text-xs font-semibold">{ROLE_LABEL_SHORT[r]}</span>
                  </span>
                  <span
                    className="num text-xs"
                    style={{ color: dentro.length >= necessari ? "var(--accent)" : "var(--warn)" }}
                    title={`Ne servono ${necessari} per riempire tutte le rose`}
                  >
                    {dentro.length}/{necessari}
                  </span>
                </header>
                <ul className="max-h-[26rem] divide-y divide-[var(--border)] overflow-y-auto">
                  {dentro.map((g) => (
                    <li key={g.id} className="flex items-baseline gap-2 px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs">{g.name}</span>
                      <span className="shrink-0 text-[0.62rem] text-[var(--text-faint)]">
                        {g.team}
                      </span>
                      <span className="num shrink-0 text-[0.68rem] text-[var(--text-muted)]">
                        {g.quotation_current ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
