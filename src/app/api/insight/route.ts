import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/fanta/types";
import { askOpenRouter, extractJson } from "@/lib/fanta/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Quanto teniamo buona un'analisi qualitativa prima di rigenerarla. */
const CACHE_DAYS = 7;

type Insight = {
  summary: string;
  pros: string[];
  cons: string[];
  risk: string | null;
  verdict: string | null;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  // Questa chiamata costa soldi veri a ogni richiesta: il livello si controlla
  // qui, non solo nel modulo che nasconde il bottone.
  const { data: profilo } = await supabase
    .from("profiles")
    .select("is_admin, is_premium")
    .eq("id", user.id)
    .single();
  if (!profilo?.is_admin && !profilo?.is_premium) {
    return NextResponse.json(
      { error: "Il contesto qualitativo è una funzione premium." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const playerId = String(body.playerId ?? "");
  const force = Boolean(body.force);
  const wantWeb = Boolean(body.web);
  if (!playerId) return NextResponse.json({ error: "playerId mancante" }, { status: 400 });

  const { data: player } = await supabase
    .from("players")
    .select("id, name, team, role, season, quotation_current, fvm, player_stats(*)")
    .eq("id", playerId)
    .single();
  if (!player) return NextResponse.json({ error: "Giocatore non trovato" }, { status: 404 });

  // Le due fonti hanno cache separate: quella con ricerca web e' piu' fresca ma
  // costa di piu', non ha senso che una sovrascriva l'altra.
  const source = wantWeb ? "web" : "ai";

  if (!force) {
    const since = new Date(Date.now() - CACHE_DAYS * 864e5).toISOString();
    const { data: cached } = await supabase
      .from("player_insights")
      .select("payload, created_at")
      .eq("player_id", playerId)
      .eq("source", source)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached) {
      return NextResponse.json({ insight: cached.payload as Insight, cached: true, source });
    }
  }

  const stats = (player.player_stats ?? []).slice().sort((a, b) => (a.season < b.season ? 1 : -1))[0];
  const statLine = stats
    ? `Stagione ${stats.season}: ${stats.matches} presenze a voto, media voto ${stats.avg_vote ?? "n/d"}, fantamedia ${stats.avg_fantavote ?? "n/d"}, ${stats.goals} gol, ${stats.assists} assist, ${stats.yellow_cards} ammonizioni, ${stats.red_cards} espulsioni, ${stats.pen_scored} rigori segnati su ${stats.pen_scored + stats.pen_missed} calciati.`
    : "Nessuna statistica di Serie A disponibile per la scorsa stagione.";

  const prompt = `Sei uno scout di fantacalcio italiano. Analizza questo giocatore per l'asta della stagione 2026/27.

Giocatore: ${player.name}
Squadra: ${player.team}
Ruolo: ${ROLE_LABEL[player.role as "P" | "D" | "C" | "A"]}
Quotazione ufficiale: ${player.quotation_current ?? "n/d"}
${statLine}

${wantWeb ? "Cerca online le notizie piu' recenti su questo giocatore prima di rispondere.\n\n" : ""}Concentrati SOLO su quello che le statistiche non dicono: posizione nelle gerarchie della squadra, concorrenti nel ruolo, chi calcia i rigori, cambi di allenatore o modulo, trasferimenti, storico infortuni, eta' e tendenza di rendimento.

Regole:
- Non inventare numeri: se non conosci un dato, non citarlo.
- Se non hai informazioni aggiornate sulla stagione 2026/27, dillo esplicitamente nel campo summary.
- Scrivi in italiano, tono asciutto e concreto, niente entusiasmi da telecronaca.
- Niente consigli di prezzo: i prezzi li calcola gia' il software.

Rispondi SOLO con un oggetto JSON valido, senza testo attorno, con questa forma:
{"summary": "2-3 frasi", "pros": ["max 4 punti brevi"], "cons": ["max 4 punti brevi"], "risk": "il rischio principale in una frase, oppure null", "verdict": "una frase di sintesi, oppure null"}`;

  const answer = await askOpenRouter({ prompt, web: wantWeb, maxTokens: 700 });
  if (!answer.ok) return NextResponse.json({ error: answer.error }, { status: answer.status });

  const parsed = extractJson<{
    summary?: unknown;
    pros?: unknown;
    cons?: unknown;
    risk?: unknown;
    verdict?: unknown;
  }>(answer.data.content);
  if (!parsed) {
    return NextResponse.json({ error: "Risposta del modello non interpretabile." }, { status: 502 });
  }
  const insight: Insight = {
    summary: String(parsed.summary ?? "").slice(0, 1200),
    pros: Array.isArray(parsed.pros) ? parsed.pros.slice(0, 4).map(String) : [],
    cons: Array.isArray(parsed.cons) ? parsed.cons.slice(0, 4).map(String) : [],
    risk: parsed.risk ? String(parsed.risk).slice(0, 400) : null,
    verdict: parsed.verdict ? String(parsed.verdict).slice(0, 400) : null,
  };
  const model = answer.data.model;

  await supabase.from("player_insights").insert({
    player_id: playerId,
    source,
    model,
    payload: insight,
    expires_at: new Date(Date.now() + CACHE_DAYS * 864e5).toISOString(),
  });

  return NextResponse.json({ insight, cached: false, model, source, cost: answer.data.cost });
}
