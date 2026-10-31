import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askOpenRouterJson } from "@/lib/fanta/openrouter";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Il modello interviene solo dove il riconoscimento locale si e' fermato.
 *
 * Non gli si chiede di trascrivere — quello lo fa il browser — e nemmeno di
 * sapere chi gioca dove. Gli si da' la frase sentita e **l'elenco dei candidati
 * che il confronto locale ha gia' ristretto**, e gli si chiede solo di
 * scegliere. E' un compito piccolo, senza ricerca web, e per questo costa una
 * frazione di centesimo invece dei $0.0075 di un recupero.
 *
 * Un'asta va veloce: se il modello non risponde in fretta e' peggio che non
 * averlo, quindi c'e' un tetto di tempo e il fallimento non e' un errore — si
 * torna a quello che aveva capito la macchina locale.
 */

/** Il modello per questo compito: piccolo, e se possibile gratuito. */
const MODELLO = () => process.env.OPENROUTER_VOICE_MODEL || "google/gemini-2.5-flash-lite";

/** Oltre questo, l'asta e' gia' andata avanti e la risposta non serve piu'. */
const TEMPO_MASSIMO_MS = 6000;

type Candidato = {
  id: string;
  name: string;
  team: string;
  /** Il ruolo e il nome per esteso: e' quello che scioglie gli omonimi. */
  role?: string | null;
  fullName?: string | null;
  punteggio: number;
};

const RUOLO_ESTESO: Record<string, string> = {
  P: "portiere",
  D: "difensore",
  C: "centrocampista",
  A: "attaccante",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const frase = String(body.frase ?? "").slice(0, 400).trim();
  const candidati: Candidato[] = Array.isArray(body.candidati) ? body.candidati.slice(0, 12) : [];
  const partecipanti: { id: string; name: string }[] = Array.isArray(body.partecipanti)
    ? body.partecipanti.slice(0, 16)
    : [];
  // I nomi di chi e' gia' stato venduto, fra i candidati: il banditore non li
  // richiama, e dirlo al modello costa una riga.
  const gia: string[] = Array.isArray(body.gia)
    ? body.gia.slice(0, 12).map((x: unknown) => String(x).slice(0, 40))
    : [];
  if (!frase) return NextResponse.json({ error: "Frase mancante." }, { status: 400 });
  if (candidati.length === 0) {
    return NextResponse.json({ playerId: null, prezzo: null, partecipanteId: null, perche: "nessun candidato" });
  }

  // Ogni candidato con tutta l'anagrafica che abbiamo: nome per esteso, ruolo,
  // squadra. Cosi' "Martinez" smette di essere una domanda senza risposta —
  // uno e' l'attaccante dell'Inter, l'altro il portiere dell'Inter — e la
  // frase quasi sempre contiene gia' quello che serve a distinguerli.
  const scheda = (c: Candidato) =>
    [
      `- id ${c.id}: ${c.name}`,
      c.fullName && c.fullName.toLowerCase() !== c.name.toLowerCase() ? `(${c.fullName})` : null,
      `— ${c.role ? RUOLO_ESTESO[c.role] ?? c.role : "ruolo ignoto"} del ${c.team}`,
    ]
      .filter(Boolean)
      .join(" ");

  const prompt = `Sei l'assistente di un'asta del fantacalcio. Il banditore ha detto, e un riconoscimento vocale ha trascritto (con errori):

"${frase}"

Il confronto automatico ha ristretto i giocatori possibili a questi. Scegli fra questi e basta, non inventarne altri:
${candidati.map(scheda).join("\n")}
${gia.length > 0 ? `\nQuesti sono gia' stati venduti e il banditore non li richiama, a meno che non stia correggendo un errore: ${gia.join(", ")}.\n` : ""}
Le squadre partecipanti all'asta sono:
${partecipanti.map((p) => `- id ${p.id}: ${p.name}`).join("\n") || "- nessuna"}

Il banditore di solito dice il giocatore, il prezzo e a chi va, in quest'ordine ma non sempre. La trascrizione storpia i nomi stranieri: "Cialanoglu" e' Calhanoglu, "Mhitarian" e' Mkhitaryan. I numeri possono essere in cifre o in lettere. Quando nella frase compare una squadra ("della Juve", "dell'Inter") o un ruolo ("il portiere"), quello e' il dato che decide: due giocatori possono avere lo stesso cognome, non la stessa coppia squadra-ruolo.

Rispondi SOLO con JSON:
{"player_id":"l'id scelto o null","prezzo":numero o null,"partecipante_id":"l'id o null","confidenza":"alta|media|bassa","perche":"una frase breve sul perche'"}

Se la trascrizione non basta a scegliere, metti null e confidenza "bassa": e' molto meglio di una scelta inventata, perche' chi legge deve poter fidarsi di quando dici di essere sicuro.`;

  const risposta = await Promise.race([
    askOpenRouterJson<{
      player_id?: string | null;
      prezzo?: number | null;
      partecipante_id?: string | null;
      confidenza?: string;
      perche?: string;
    }>({ prompt, web: false, maxTokens: 200, temperature: 0, model: MODELLO() }),
    new Promise<null>((r) => setTimeout(() => r(null), TEMPO_MASSIMO_MS)),
  ]);

  if (!risposta || !risposta.ok) {
    return NextResponse.json({
      playerId: null,
      prezzo: null,
      partecipanteId: null,
      perche: risposta ? risposta.error : `nessuna risposta entro ${TEMPO_MASSIMO_MS / 1000}s`,
      costo: risposta ? risposta.cost : 0,
    });
  }

  // Un id che non era fra i candidati e' inventato: si scarta invece di
  // scriverlo addosso a un giocatore a caso.
  const d = risposta.data;
  const scelto = candidati.find((c) => c.id === String(d.player_id ?? ""));
  const compratore = partecipanti.find((p) => p.id === String(d.partecipante_id ?? ""));
  const prezzo = Number(d.prezzo);

  return NextResponse.json({
    playerId: scelto?.id ?? null,
    nomeGiocatore: scelto?.name ?? null,
    prezzo: Number.isFinite(prezzo) && prezzo > 0 ? Math.round(prezzo) : null,
    partecipanteId: compratore?.id ?? null,
    nomePartecipante: compratore?.name ?? null,
    confidenza: d.confidenza === "alta" ? 0.9 : d.confidenza === "media" ? 0.7 : 0.4,
    perche: String(d.perche ?? "").slice(0, 200),
    modello: risposta.model,
    costo: risposta.cost,
    fuoriElenco: d.player_id != null && !scelto,
  });
}
