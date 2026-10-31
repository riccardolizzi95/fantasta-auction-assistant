"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addParticipant, updateParticipant } from "@/app/actions";

/**
 * Le squadre del tabellone e le nostre, quando non battono.
 *
 * Il ponte trova le colonne cercando i **nostri** nomi: una squadra che di la'
 * si chiama diversamente e' invisibile due volte — non se ne trova la colonna,
 * e i suoi acquisti non arrivano mai. Peggio ancora quando di la' ce ne sono
 * di piu': cercando solo i nostri nomi si trovava tutto quello che si cercava,
 * e le altre non le guardava nessuno.
 *
 * Quindi devono battere i nomi **e** il numero. Qui si vede la differenza fra
 * le due liste e si aggancia a mano: rinominando una delle nostre, o
 * aggiungendo quella che manca. Niente viene deciso da solo — abbinare due
 * squadre a indovinare vuol dire scrivere gli acquisti di uno nella rosa di un
 * altro, e ce ne si accorge a fine asta.
 */
function AgganciaSquadre({
  leagueId,
  puoScrivere,
  flottante = false,
}: {
  leagueId: string;
  /** Rinominare e aggiungere squadre le puo' fare solo chi ha creato la lega. */
  puoScrivere: boolean;
  /** Sulla schermata d'asta non c'e' un posto dove starsene: sta sopra a tutto. */
  flottante?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [viste, setViste] = useState<string[]>([]);
  /**
   * Se il ponte sta guardando il tabellone **adesso**.
   *
   * I nomi letti restano scritti nella lega anche dopo che il ponte e' stato
   * spento: sono l'ultima cosa che ha visto, non quello che c'e' adesso. Senza
   * questa domanda il riquadro restava aperto per ore su una differenza che
   * non esisteva piu' — e a un certo punto e' rumore, non un avviso. La soglia
   * e' la stessa della riga "ponte acceso": quaranta secondi, due battiti.
   */
  const [acceso, setAcceso] = useState(false);
  const [nostre, setNostre] = useState<{ id: string; name: string }[]>([]);
  const [scelta, setScelta] = useState<Record<string, string>>({});
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [chiuso, setChiuso] = useState(false);

  useEffect(() => {
    if (!puoScrivere) return;
    let vivo = true;
    const leggi = async () => {
      const [{ data: lega }, { data: parts }] = await Promise.all([
        supabase
          .from("leagues")
          .select("bridge_squadre, bridge_seen_at")
          .eq("id", leagueId)
          .maybeSingle(),
        supabase
          .from("participants")
          .select("id, name")
          .eq("league_id", leagueId)
          .order("created_at"),
      ]);
      if (!vivo) return;
      const riga = lega as { bridge_squadre?: unknown; bridge_seen_at?: string | null } | null;
      setViste(Array.isArray(riga?.bridge_squadre) ? (riga!.bridge_squadre as string[]) : []);
      const visto = riga?.bridge_seen_at ? Date.parse(riga.bridge_seen_at) : 0;
      setAcceso(visto > 0 && Date.now() - visto < 40_000);
      setNostre((parts ?? []) as { id: string; name: string }[]);
    };
    void leggi();
    const t = setInterval(() => void leggi(), 10_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [supabase, leagueId, puoScrivere]);

  const disallineate = useMemo(() => {
    /**
     * Il confronto e' **esatto**, e deve restare esatto.
     *
     * Il ponte trova una colonna cosi': `textContent.trim() === nome`. Non
     * appiana niente — ne' maiuscole, ne' accenti, ne' underscore. Se qui si
     * confrontasse con la mano larga, si direbbe "tutto a posto" proprio
     * mentre di la' quella colonna non si trova: e' successo con "Mario__",
     * che appianato diventava "mario" e sembrava la stessa squadra, mentre
     * il ponte contava 4 colonne su 5. Questo riquadro deve dire quello che il
     * ponte **puo'** fare, non quello che a occhio sembra uguale.
     */
    const pulisci = (x: string) => x.trim();
    const nostri = new Set(nostre.map((p) => pulisci(p.name)));
    const loro = new Set(viste.map((v) => pulisci(v)));
    return {
      senzaRiscontro: viste.filter((v) => !nostri.has(pulisci(v))),
      nostreOrfane: nostre.filter((p) => !loro.has(pulisci(p.name))),
    };
  }, [viste, nostre]);

  async function aggancia(nomeDiLa: string, participantId: string) {
    setOccupato(true);
    setErrore(null);
    try {
      const fd = new FormData();
      fd.set("league_id", leagueId);
      fd.set("participant_id", participantId);
      fd.set("name", nomeDiLa);
      const esito = await updateParticipant({}, fd);
      if (esito?.error) throw new Error(esito.error);
      setNostre((p) => p.map((x) => (x.id === participantId ? { ...x, name: nomeDiLa } : x)));
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function aggiungiSquadra(nomeDiLa: string) {
    setOccupato(true);
    setErrore(null);
    try {
      const fd = new FormData();
      fd.set("league_id", leagueId);
      fd.set("name", nomeDiLa);
      await addParticipant(fd);
      setNostre((p) => [...p, { id: "nuova-" + nomeDiLa, name: nomeDiLa }]);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  if (!puoScrivere) return null;
  // Col ponte spento non c'e' niente da agganciare: i nomi che abbiamo sono un
  // ricordo, e la differenza la si sistema quando il ponte torna a guardare.
  if (!acceso) return null;
  if (viste.length === 0) return null;
  const quadra =
    disallineate.senzaRiscontro.length === 0 && disallineate.nostreOrfane.length === 0;
  if (quadra || chiuso) return null;

  const corpo = (
    <div
      className="rounded border p-3"
      style={{ borderColor: "var(--warn)", background: flottante ? "var(--bg-elevated)" : undefined }}
    >
      <div className="flex items-start gap-2">
        <div className="label-xs mb-1 mr-auto" style={{ color: "var(--warn)" }}>
          Le squadre non battono col tabellone
        </div>
        {flottante && (
          <button
            className="text-[0.62rem] text-[var(--text-faint)] underline"
            onClick={() => setChiuso(true)}
          >
            più tardi
          </button>
        )}
      </div>
      <p className="mb-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        Sul tabellone ci sono <strong>{viste.length}</strong> squadre, qui{" "}
        <strong>{nostre.length}</strong>. Il ponte cerca il nome <em>esatto</em>: anche un trattino
        in più è un&apos;altra squadra, e finché non combaciano i suoi acquisti non arrivano.
      </p>
      {errore && (
        <p className="mb-2 text-[0.68rem]" style={{ color: "var(--danger)" }}>
          {errore}
        </p>
      )}
      <div className="grid gap-2">
        {disallineate.senzaRiscontro.map((nome) => (
          <div key={nome} className="flex flex-wrap items-center gap-2">
            <span className="num mr-auto text-xs font-semibold">{nome}</span>
            {disallineate.nostreOrfane.length > 0 && (
              <>
                <select
                  className="text-xs"
                  value={scelta[nome] ?? ""}
                  onChange={(e) => setScelta({ ...scelta, [nome]: e.target.value })}
                >
                  <option value="">è una delle nostre…</option>
                  {disallineate.nostreOrfane.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm"
                  disabled={occupato || !scelta[nome]}
                  onClick={() => void aggancia(nome, scelta[nome])}
                >
                  Aggancia
                </button>
              </>
            )}
            <button
              className="btn btn-sm"
              disabled={occupato}
              onClick={() => void aggiungiSquadra(nome)}
            >
              Aggiungila
            </button>
          </div>
        ))}
        {disallineate.senzaRiscontro.length === 0 && disallineate.nostreOrfane.length > 0 && (
          <p className="text-[0.68rem] text-[var(--text-faint)]">
            Sul tabellone non c&apos;è nessuna colonna per{" "}
            <strong>{disallineate.nostreOrfane.map((p) => p.name).join(", ")}</strong>: o la squadra
            va creata di là, o qui va tolta.
          </p>
        )}
      </div>
      {disallineate.senzaRiscontro.length > 0 && disallineate.nostreOrfane.length > 0 && (
        <p className="mt-2 text-[0.62rem] text-[var(--text-faint)]">
          Senza colonna sul tabellone: {disallineate.nostreOrfane.map((p) => p.name).join(", ")}.
        </p>
      )}
    </div>
  );

  if (!flottante) return <div className="mt-3">{corpo}</div>;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-28 z-40 flex justify-center px-4 lg:top-16">
      <div className="pointer-events-auto w-full max-w-xl shadow-2xl">{corpo}</div>
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
export default memo(AgganciaSquadre);
