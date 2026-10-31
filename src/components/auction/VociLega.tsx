"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { apriMicrofono, type Microfono, type Segmento } from "@/lib/fanta/microfono";
import { somiglianza } from "@/lib/fanta/astaVocale";
import {
  SECONDI_LETTURA,
  SOMIGLIANZA_MINIMA,
  TESTO_DA_LEGGERE,
} from "@/lib/fanta/testoDaLeggere";
import {
  chiHaParlato,
  fondiImpronte,
  somiglianzaVoci,
  taraSullaLega,
  type Profilo,
} from "@/lib/fanta/voce";
import {
  abbonatiAiProfili,
  cancellaProfilo,
  leggiProfili,
  profiliInMemoria,
  salvaProfilo,
} from "@/lib/fanta/vociLocali";

/**
 * Insegnare al software le voci della lega.
 *
 * Si fa una volta sola, prima dell'asta: ognuno legge lo stesso testo ad alta
 * voce e il software si tiene una firma della sua voce. Poi, quando qualcuno
 * rilancia senza che il banditore dica il nome, sa da chi e' arrivato.
 *
 * Tre scelte che non sono dettagli. Le impronte restano su questo dispositivo:
 * sono voci di altre persone. Il testo e' **uguale per tutti** e tocca tutti i
 * suoni dell'italiano, perche' un'impronta vale quanto i suoni che ha visto. E
 * alla fine c'e' una **prova**, perche' quanto ci prende dipende da quanto vi
 * somigliate e da com'e' fatta la stanza — cose che nessuno puo' sapere in
 * anticipo, e che e' meglio scoprire il giorno prima che all'asta.
 */

type Partecipante = { id: string; name: string };

type Riconoscitore = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function creaRiconoscitore(): Riconoscitore | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Riconoscitore;
    webkitSpeechRecognition?: new () => Riconoscitore;
  };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

const soloParole = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default function VociLega({
  legaId,
  partecipanti,
}: {
  legaId: string;
  partecipanti: Partecipante[];
}) {
  const profili = useSyncExternalStore(
    abbonatiAiProfili,
    () => leggiProfili(legaId),
    () => profiliInMemoria(legaId),
  );
  const [chiLegge, setChiLegge] = useState<Partecipante | null>(null);
  const [secondi, setSecondi] = useState(0);
  const [pezzi, setPezzi] = useState(0);
  const [sentito, setSentito] = useState("");
  const [esito, setEsito] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [prova, setProva] = useState(false);
  const [chiSento, setChiSento] = useState<string | null>(null);
  const [ultimi, setUltimi] = useState<(string | null)[]>([]);

  const mic = useRef<Microfono | null>(null);
  const rec = useRef<Riconoscitore | null>(null);
  const raccolte = useRef<Float32Array[]>([]);
  const trascritto = useRef("");
  const orologio = useRef<number | null>(null);

  useEffect(() => () => fermaTutto(), []);

  const metro = useMemo(() => (profili.length >= 2 ? taraSullaLega(profili) : null), [profili]);

  /** Quanto ciascuno somiglia a se stesso fra le due meta' della lettura. */
  const stabilitaDi = useCallback(
    (p: Profilo) => {
      if (!p.meta || !metro) return null;
      const c = (v: number[]) => {
        const o = new Float32Array(v.length);
        for (let i = 0; i < v.length; i++) o[i] = v[i] - (metro.centro[i] ?? 0);
        let n = 0;
        for (let i = 0; i < o.length; i++) n += o[i] * o[i];
        n = Math.sqrt(n) || 1;
        for (let i = 0; i < o.length; i++) o[i] /= n;
        return o;
      };
      return somiglianzaVoci(c(p.meta[0]), c(p.meta[1]));
    },
    [metro],
  );

  function fermaTutto() {
    if (orologio.current !== null) window.clearInterval(orologio.current);
    orologio.current = null;
    mic.current?.chiudi();
    mic.current = null;
    try {
      rec.current?.stop();
    } catch {
      /* gia' fermo */
    }
    rec.current = null;
  }

  const chiudiLettura = useCallback(
    (p: Partecipante) => {
      fermaTutto();
      setChiLegge(null);
      const firme = raccolte.current;
      raccolte.current = [];

      const imp = fondiImpronte(firme);
      if (!imp) {
        setEsito(null);
        setErrore(
          `Non ho sentito abbastanza da ${p.name}. Controlla che il microfono prenda, e falla rileggere più vicino.`,
        );
        return;
      }

      // Se il browser ha ascoltato, si controlla che abbia letto **questo**
      // testo: senza, una lettura biascicata o un microfono sordo passano lisci
      // e il problema salta fuori all'asta.
      const detto = soloParole(trascritto.current);
      if (detto.length > 12) {
        const quanto = somiglianza(detto, soloParole(TESTO_DA_LEGGERE));
        if (quanto < SOMIGLIANZA_MINIMA) {
          setEsito(null);
          setErrore(
            `Quello che ho sentito non somiglia al testo (${Math.round(quanto * 100)}%). ` +
              `Rifallo leggendo tutto ad alta voce, senza fretta.`,
          );
          return;
        }
      }

      const meta = Math.ceil(firme.length / 2);
      const a = fondiImpronte(firme.slice(0, meta));
      const b = fondiImpronte(firme.slice(meta));
      salvaProfilo(legaId, {
        participantId: p.id,
        nome: p.name,
        impronta: Array.from(imp),
        meta: a && b ? [Array.from(a), Array.from(b)] : undefined,
      });
      setErrore(null);
      setEsito(`${p.name}: voce registrata su ${firme.length} pezzi di parlato.`);
    },
    [legaId],
  );

  const leggi = useCallback(
    async (p: Partecipante) => {
      fermaTutto();
      setErrore(null);
      setEsito(null);
      setProva(false);
      setSentito("");
      setPezzi(0);
      setSecondi(0);
      raccolte.current = [];
      trascritto.current = "";
      setChiLegge(p);

      try {
        mic.current = await apriMicrofono({
          onSegmento: (s: Segmento) => {
            raccolte.current.push(s.impronta);
            setPezzi(raccolte.current.length);
          },
        });
      } catch {
        setErrore("Il browser non ha dato accesso al microfono.");
        setChiLegge(null);
        return;
      }

      // Il riconoscimento del parlato gira in parallelo solo per controllare che
      // stia leggendo il testo giusto: l'impronta la fa il microfono, non lui.
      const r = creaRiconoscitore();
      if (r) {
        r.lang = "it-IT";
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          let tutto = "";
          for (let i = 0; i < e.results.length; i++) tutto += e.results[i][0].transcript + " ";
          trascritto.current = tutto;
          setSentito(tutto.trim().slice(-90));
        };
        r.onerror = () => {};
        r.onend = () => {};
        try {
          r.start();
          rec.current = r;
        } catch {
          /* si prosegue senza il controllo del testo */
        }
      }

      orologio.current = window.setInterval(() => {
        setSecondi((s) => {
          if (s + 1 >= SECONDI_LETTURA) {
            chiudiLettura(p);
            return SECONDI_LETTURA;
          }
          return s + 1;
        });
      }, 1000);
    },
    [chiudiLettura],
  );

  const avviaProva = useCallback(async () => {
    fermaTutto();
    setErrore(null);
    setUltimi([]);
    setChiSento(null);
    setProva(true);
    const attuali = leggiProfili(legaId);
    const m = taraSullaLega(attuali);
    try {
      mic.current = await apriMicrofono({
        onSegmento: (s) => {
          const chi = chiHaParlato(s.impronta, attuali, m);
          setChiSento(chi?.nome ?? null);
          setUltimi((e) => [chi?.nome ?? null, ...e].slice(0, 12));
        },
      });
    } catch {
      setErrore("Il browser non ha dato accesso al microfono.");
      setProva(false);
    }
  }, [legaId]);

  const perId = new Map(profili.map((p) => [p.participantId, p]));

  return (
    <div className="space-y-3">
      {/* -------------------------------------------------- chi legge adesso */}
      {chiLegge && (
        <div className="panel-flat p-4" style={{ borderColor: "var(--accent-dim)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label-xs" style={{ color: "var(--accent)" }}>
              {chiLegge.name} sta leggendo
            </span>
            <span className="num text-xs text-[var(--text-faint)]">
              {SECONDI_LETTURA - secondi}s · {pezzi} pezzi di parlato
            </span>
          </div>
          <p className="mt-2 text-lg leading-relaxed">{TESTO_DA_LEGGERE}</p>
          <div className="mt-3 h-1 w-full rounded-full bg-[var(--bg-elevated)]">
            <div
              className="h-1 rounded-full transition-all"
              style={{
                width: `${(secondi / SECONDI_LETTURA) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
          {sentito && (
            <p className="mt-2 truncate text-xs italic text-[var(--text-faint)]">…{sentito}</p>
          )}
          <button className="btn btn-sm mt-3" onClick={() => chiudiLettura(chiLegge)}>
            Ho finito
          </button>
        </div>
      )}

      {/* Le voci si registrano per i fantallenatori che esistono nella lega, e
          se ce n'e' uno solo non c'e' niente da distinguere. Senza dirlo, il
          pannello sembra rotto: mostra un nome, si registra, e poi non si
          capisce dove aggiungere gli altri. */}
      {partecipanti.length < 2 && (
        <div className="panel-flat px-3 py-2" style={{ borderColor: "var(--warn)" }}>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            Qui compaiono i fantallenatori della lega, e per ora ce n&apos;è
            {partecipanti.length === 1 ? " solo uno" : " nessuno"}. Aggiungi gli altri nel riquadro{" "}
            <strong>Partecipanti</strong> qui sopra — bastano i nomi — e ognuno avrà il suo testo da
            leggere.
          </p>
        </div>
      )}

      {/* -------------------------------------------------- l'elenco */}
      <div className="space-y-2">
        {partecipanti.map((p) => {
          const profilo = perId.get(p.id);
          const stabile = profilo ? stabilitaDi(profilo) : null;
          return (
            <div key={p.id} className="panel-flat flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="flex-1 truncate text-sm font-medium">
                {p.name}
                {profilo && (
                  <span className="chip ml-2" style={{ color: "var(--accent)" }}>
                    voce registrata
                  </span>
                )}
                {/* Se le due meta' della stessa lettura non si somigliano, quella
                    iscrizione non vale niente: meglio saperlo adesso. */}
                {stabile !== null && stabile < 0.5 && (
                  <span className="chip ml-2" style={{ color: "var(--warn)" }}>
                    lettura incerta, meglio rifarla
                  </span>
                )}
              </span>
              <button
                className="btn btn-sm"
                onClick={() => void leggi(p)}
                disabled={chiLegge !== null}
              >
                {profilo ? "Rifai" : "Leggi il testo"}
              </button>
              {profilo && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => cancellaProfilo(legaId, p.id)}
                  disabled={chiLegge !== null}
                >
                  Cancella
                </button>
              )}
            </div>
          );
        })}
      </div>

      {esito && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>
          {esito}
        </p>
      )}

      {/* -------------------------------------------------- quanto ci si puo' fidare */}
      {metro && (
        <div className="panel-flat px-3 py-2">
          <div className="label-xs">Quanto si distinguono, queste voci</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            {metro.separabilita > 0.12
              ? "Bene: sono abbastanza diverse fra loro. Durante l'asta il riconoscimento dovrebbe reggere."
              : metro.separabilita > 0.06
                ? "Così così: alcune si somigliano. Riconoscerà i casi facili e dirà «non lo so» sugli altri, che è quello che deve fare."
                : "Queste voci si somigliano troppo. Il software preferirà tacere piuttosto che sbagliare nome — rifare le letture in un posto più silenzioso di solito aiuta."}
          </p>
        </div>
      )}

      {/* -------------------------------------------------- la prova sul campo */}
      <div className="panel-flat px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`btn btn-sm ${prova ? "" : "btn-primary"}`}
            onClick={prova ? () => { fermaTutto(); setProva(false); } : () => void avviaProva()}
            disabled={profili.length < 2 || chiLegge !== null}
          >
            {prova ? "Basta" : "Prova"}
          </button>
          <span className="text-xs text-[var(--text-muted)]">
            {partecipanti.length < 2
              ? "Con un solo fantallenatore non c'è nessuno da distinguere."
              : profili.length < 2
                ? "Servono almeno due voci registrate."
                : prova
                  ? chiSento
                    ? `sento ${chiSento}`
                    : "non riconosco chi parla"
                  : "Fate parlare qualcuno a turno e guardate se ci prende. È l'unico modo di sapere quanto ci prenderà con le vostre voci."}
          </span>
        </div>
        {ultimi.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ultimi.map((nome, i) => (
              <span
                key={i}
                className="chip"
                style={{ color: nome ? "var(--accent)" : "var(--text-faint)" }}
              >
                {nome ?? "non lo so"}
              </span>
            ))}
          </div>
        )}
      </div>

      {errore && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {errore}
        </p>
      )}

      <p className="text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
        Il testo è lo stesso per tutti apposta: se ognuno dicesse una cosa diversa, una parte della
        differenza fra due impronte sarebbe la frase e non la persona. Le impronte restano in questo
        browser e non vengono caricate da nessuna parte — quindi vanno registrate qui tutte le voci
        che questo microfono dovrà riconoscere, e chi segue l&apos;asta da un altro computer deve
        rifare le letture lì.
      </p>
    </div>
  );
}
