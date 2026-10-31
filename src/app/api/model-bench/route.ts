import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  askOpenRouter,
  extractJson,
  type ProviderRouting,
  type WebEngine,
} from "@/lib/fanta/openrouter";
import { buildIdentifyPrompt, parseIdentities, type PlayerToIdentify } from "@/lib/fanta/identify";
import { identifyTokenBudget, toRecover } from "@/lib/fanta/recovery";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Banco di prova per scegliere modello, fornitore e motore di ricerca.
 *
 * Un modello va scelto misurandolo sul lavoro che deve fare, non sul prezzo di
 * listino. Ma il prezzo di listino del modello, qui, non e' nemmeno la voce
 * principale: la ricerca web pesa piu' dei token, e OpenRouter la offre con
 * motori diversi a prezzi che differiscono di sette volte. Quindi il banco non
 * confronta modelli: confronta **configurazioni** — modello, fornitore, motore,
 * numero di risultati — sullo stesso compito reale, e riporta costo, token,
 * tempo e quanto ognuna azzecca.
 *
 * La colonna che conta di piu' non e' il costo di una configurazione ma la
 * differenza fra due: girare la stessa domanda con e senza ricerca web e'
 * l'unico modo di sapere quanto costa davvero la ricerca, perche' OpenRouter
 * riporta un totale unico.
 */

/** Una configurazione da provare. */
type Run = {
  label?: string;
  model: string;
  engine?: WebEngine;
  maxResults?: number;
  web?: boolean;
  provider?: ProviderRouting;
};

type Risposta = {
  /**
   * A chi si riferisce. Prima c'era solo la posizione nell'elenco, e bastava
   * che una query restituisse le righe in un altro ordine perche' il banco
   * attribuisse a un giocatore il nome di un altro — e su quel confronto si
   * sarebbe scelto il modello.
   */
  playerId: string;
  listone: string;
  squadra: string;
  nome: string | null;
  anno: number | null;
  fiducia: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Serve un amministratore." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const runs: Run[] = Array.isArray(body.runs) ? body.runs.slice(0, 12) : [];
  if (runs.length === 0 || runs.some((r) => !r.model)) {
    return NextResponse.json({ error: "Serve runs: [{ model, ... }]." }, { status: 400 });
  }

  const targets = await pickPlayers(supabase, body);
  if (targets.length === 0) {
    return NextResponse.json({ error: "Nessun giocatore su cui provare." }, { status: 404 });
  }

  // Lo stesso identico prompt per tutti: se cambiasse anche solo l'elenco dei
  // giocatori, il confronto misurerebbe la difficolta' del campione invece della
  // configurazione.
  const prompt = buildIdentifyPrompt(targets);
  const maxTokens = identifyTokenBudget(targets.length);

  const results = await Promise.all(
    runs.map(async (r) => {
      const t0 = Date.now();
      const answer = await askOpenRouter({
        prompt,
        model: r.model,
        web: r.web !== false,
        webResults: r.maxResults ?? 5,
        engine: r.engine,
        provider: r.provider,
        maxTokens,
        temperature: 0.1,
        json: true,
      });
      const ms = Date.now() - t0;
      const label = r.label ?? etichetta(r);
      if (!answer.ok) return { label, ...r, ok: false, ms, error: answer.error };

      const parsed = extractJson<{ players?: Record<string, unknown>[] }>(answer.data.content);
      const identities = parseIdentities(parsed as never, targets);
      const risposte: Risposta[] = targets.map((p) => {
        const i = identities.get(p.id);
        return {
          playerId: p.id,
          listone: p.name,
          squadra: p.team,
          nome: i?.fullName ?? null,
          anno: i?.birthYear ?? null,
          fiducia: i?.confidence ?? null,
        };
      });
      return {
        label,
        ...r,
        ok: true,
        ms,
        cost: answer.data.cost,
        promptTokens: answer.data.usage.promptTokens,
        completionTokens: answer.data.usage.completionTokens,
        servito: answer.data.usage.provider,
        troncata: answer.data.finishReason === "length",
        jsonValido: parsed != null,
        trovati: risposte.filter((x) => x.nome).length,
        fiduciaAlta: risposte.filter((x) => x.fiducia === "alta").length,
        risposte,
      };
    }),
  );

  return NextResponse.json({
    players: targets.map((p) => ({ id: p.id, name: p.name, team: p.team })),
    results,
    consenso: consenso(targets, results),
  });
}

function etichetta(r: Run): string {
  const pezzi = [r.model.split("/").pop() ?? r.model];
  if (r.web === false) pezzi.push("senza web");
  else pezzi.push(`${r.engine ?? "default"}×${r.maxResults ?? 5}`);
  if (r.provider?.order?.length) pezzi.push(`via ${r.provider.order[0]}`);
  return pezzi.join(" · ");
}

/**
 * Su chi provare.
 *
 * Di default i primi della coda vera del recupero: sono i casi difficili che il
 * software deve risolvere davvero. Un campione facile fa sembrare bravi tutti i
 * modelli e non decide niente.
 */
async function pickPlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  body: { playerIds?: unknown; take?: unknown },
): Promise<PlayerToIdentify[]> {
  const espliciti: string[] = Array.isArray(body.playerIds) ? body.playerIds.slice(0, 12) : [];
  if (espliciti.length > 0) {
    const { data } = await supabase
      .from("players")
      .select("id, name, team, role")
      .in("id", espliciti);
    // Postgres non promette l'ordine dell'elenco `in`, e chi confronta due giri
    // fra loro conta sull'ordine: si rimette quello chiesto.
    const perId = new Map((data ?? []).map((p) => [p.id, p as PlayerToIdentify]));
    return espliciti.map((id) => perId.get(id)).filter((p): p is PlayerToIdentify => !!p);
  }
  const take = Math.min(12, Math.max(1, Number(body.take) || 6));
  const { data } = await supabase
    .from("players")
    .select("id, name, team, role, season, quotation_current, fvm, player_stats(season, competition, matches)")
    .eq("is_active", true)
    .order("quotation_current", { ascending: false, nullsFirst: false })
    .range(0, 999);
  type Riga = PlayerToIdentify & {
    season: string;
    quotation_current: number | null;
    fvm: number | null;
    player_stats: { season: string; competition: string | null; matches: number }[] | null;
  };
  const listone = (data ?? []) as unknown as Riga[];
  const coda = toRecover(
    listone.map((p) => ({ ...p, history: p.player_stats ?? [] })),
    listone[0]?.season ?? "",
  );
  return coda.slice(0, take).map((p) => ({ id: p.id, name: p.name, team: p.team, role: p.role }));
}

/**
 * Dove le configurazioni sono d'accordo, e dove no.
 *
 * Serve a due cose. Subito: un nome su cui tutti concordano e' quasi
 * certamente giusto, e uno su cui ognuno dice la sua e' il caso su cui il
 * software rischia di far sbagliare l'asta. E in prospettiva e' il prototipo del
 * riscontro fra fonti indipendenti — due fonti che concordano valgono piu' di
 * una fonte sicura di se'.
 */
function consenso(
  targets: PlayerToIdentify[],
  results: ({ ok: boolean; label: string } & { risposte?: Risposta[] })[],
) {
  const buoni = results.filter((r) => r.ok && r.risposte);
  return targets.map((p) => {
    const detti = new Map<string, string[]>();
    for (const r of buoni) {
      const nome = r.risposte!.find((x) => x.playerId === p.id)?.nome;
      if (!nome) continue;
      const chiave = nome
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z ]/g, "")
        .trim();
      detti.set(chiave, [...(detti.get(chiave) ?? []), r.label]);
    }
    const varianti = [...detti.entries()].sort((a, b) => b[1].length - a[1].length);
    return {
      listone: p.name,
      squadra: p.team,
      /** Quante configurazioni hanno risposto qualcosa. */
      risposte: varianti.reduce((n, v) => n + v[1].length, 0),
      /** Su quante il piu' votato mette d'accordo. */
      accordo: varianti[0]?.[1].length ?? 0,
      unanime: varianti.length === 1 && buoni.length > 1,
      varianti: varianti.map(([nome, chi]) => ({ nome, chi })),
    };
  });
}
