import { NextResponse } from "next/server";
import {
  matchStatsToPlayers,
  parseWorkbook,
  stagioneDalNome,
  type ImportKind,
} from "@/lib/fanta/importer";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Da "2026-27" a "2025-26". */
function previousSeason(season: string): string {
  const m = season.match(/^(\d{4})-(\d{2})$/);
  if (!m) return "2025-26";
  const start = Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

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
    return NextResponse.json(
      { error: "Serve un account amministratore per aggiornare il listone." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const season = String(form.get("season") || "2026-27");
  const rawKind = String(form.get("kind") || "auto");
  const forcedKind = rawKind === "auto" ? undefined : (rawKind as ImportKind);
  // Stagione a cui appartengono le statistiche caricate.
  //
  // Comanda il **nome del file**, non la tendina. Il commento che stava qui
  // diceva il contrario — che indovinarla dal nome fosse il modo piu' rapido
  // per sovrascrivere l'annata sbagliata — e la realta' ha detto l'opposto: e'
  // chiederla che ha sovrascritto un'annata intera, perche' la tendina resta
  // su quello che c'era prima e nessuno la guarda mentre trascina un file. Il
  // nome invece lo scrive il sito: `Statistiche_Fantacalcio_Stagione_2026_27`.
  const statsSeason = String(form.get("stats_season") || "").trim();
  // Un file di statistiche puo' anche non essere di Serie A (per esempio la
  // Serie B): la competizione decide il coefficiente di conversione.
  const competition = String(form.get("competition") || "serie-a").trim() || "serie-a";
  if (forcedKind === "statistiche" && !/^\d{4}-\d{2}$/.test(statsSeason)) {
    return NextResponse.json(
      { error: "Indica la stagione delle statistiche nel formato 2025-26." },
      { status: 400 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File mancante" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseWorkbook(await file.arrayBuffer(), forcedKind);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (parsed.kind === "quotazioni") {
    const rows = parsed.players.map((p) => ({
      season,
      external_id: p.external_id,
      name: p.name,
      team: p.team,
      role: p.role,
      role_mantra: p.role_mantra,
      quotation_initial: p.quotation_initial,
      quotation_current: p.quotation_current,
      fvm: p.fvm,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from("players")
        .upsert(rows.slice(i, i + 500), { onConflict: "season,external_id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Il listone e' l'elenco di chi c'e', non l'unione di tutto quello che e'
    // passato: chi non compare piu' nel file ufficiale ha lasciato la Serie A.
    // Non lo cancelliamo (potrebbe essere gia' in una rosa): lo disattiviamo.
    const ids = rows.map((r) => r.external_id).filter((x): x is number => x != null);
    let deactivated = 0;
    if (ids.length > 0) {
      const { data: gone, error: deactivateError } = await supabase
        .from("players")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("season", season)
        .eq("is_active", true)
        .not("external_id", "in", `(${ids.join(",")})`)
        .select("id");
      if (deactivateError) {
        return NextResponse.json({ error: deactivateError.message }, { status: 500 });
      }
      deactivated = gone?.length ?? 0;
    }

    return NextResponse.json({
      kind: "quotazioni",
      imported: rows.length,
      deactivated,
      season,
      headers: parsed.headers,
    });
  }

  // Se il tipo e' stato riconosciuto da solo ma la stagione non e' stata indicata,
  // usiamo quella precedente al listone: e' il caso d'uso normale.
  const stagioneDelFile = stagioneDalNome(file.name);
  const effectiveStatsSeason = stagioneDelFile || statsSeason || previousSeason(season);
  const stagioneCorretta =
    stagioneDelFile && statsSeason && stagioneDelFile !== statsSeason ? statsSeason : null;

  // Statistiche: le agganciamo ai giocatori gia' in listone, per Id ufficiale e,
  // in mancanza, per nome normalizzato.
  // Solo i giocatori del listone corrente: chi ha lasciato la Serie A resta
  // disattivato e non deve ricevere statistiche, altrimenti il conteggio
  // dell'import dice numeri che non corrispondono a nulla di utile.
  const { data: players } = await supabase
    .from("players")
    .select("id, external_id, name, team")
    .eq("season", season)
    .eq("is_active", true);

  const { matches, unmatched, matchedBy } = matchStatsToPlayers(parsed.stats, players ?? []);

  const rows: Record<string, unknown>[] = [];
  for (const { playerId, stats: s } of matches) {
    rows.push({
      player_id: playerId,
      season: effectiveStatsSeason,
      competition,
      // La squadra di **quella** stagione, che nel file c'e' e non guardavamo:
      // e' la colonna che allo storico mancava, e per le stagioni passate e'
      // l'unico posto in cui esiste senza chiedere niente a nessuno.
      club: s.team || "",
      source: "import",
      matches: s.matches,
      avg_vote: s.avg_vote,
      avg_fantavote: s.avg_fantavote,
      goals: s.goals,
      goals_conceded: s.goals_conceded,
      assists: s.assists,
      yellow_cards: s.yellow_cards,
      red_cards: s.red_cards,
      own_goals: s.own_goals,
      pen_saved: s.pen_saved,
      pen_scored: s.pen_scored,
      pen_missed: s.pen_missed,
    });
  }

  // Un upsert non puo' toccare due volte la stessa riga nello stesso batch.
  const deduped = [...new Map(rows.map((r) => [r.player_id as string, r])).values()];

  /**
   * La riga che c'era gia', anche se non aveva la squadra.
   *
   * Da quando la squadra fa parte della chiave, un upsert su una riga vecchia
   * — scritta quando la colonna non esisteva — non la aggiorna: **ne crea una
   * seconda**. Misurato sul database vero, un import ha raddoppiato le righe di
   * due stagioni intere, e il motore avrebbe sommato due volte la stessa
   * stagione. Quindi prima si guarda cosa c'e' per quel giocatore in quella
   * stagione, e se c'e' si scrive **su quella riga**, per identificativo: cosi'
   * si aggiorna invece di affiancare, e i minuti e il rating che l'archivio
   * sportivo ci aveva messo sopra restano dove sono.
   */
  const { data: esistenti } = await supabase
    .from("player_stats")
    .select("id, player_id")
    .eq("season", effectiveStatsSeason)
    .eq("competition", competition)
    .eq("source", "import")
    .in(
      "player_id",
      deduped.map((r) => r.player_id as string),
    );
  const idPerGiocatore = new Map(
    ((esistenti ?? []) as { id: string; player_id: string }[]).map((r) => [r.player_id, r.id]),
  );

  const daAggiornare = deduped
    .filter((r) => idPerGiocatore.has(r.player_id as string))
    .map((r) => ({ ...r, id: idPerGiocatore.get(r.player_id as string) }));
  const daInserire = deduped.filter((r) => !idPerGiocatore.has(r.player_id as string));

  for (let i = 0; i < daAggiornare.length; i += 500) {
    const { error } = await supabase
      .from("player_stats")
      .upsert(daAggiornare.slice(i, i + 500), { onConflict: "id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  for (let i = 0; i < daInserire.length; i += 500) {
    const { error } = await supabase
      .from("player_stats")
      .upsert(daInserire.slice(i, i + 500), { onConflict: "player_id,season,competition,club" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    kind: "statistiche",
    // Se il file diceva un'altra stagione, si dice: e' successo davvero, e chi
    // carica deve sapere che quello che ha scelto e' stato ignorato.
    correttaDa: stagioneCorretta,
    seasonFromFile: stagioneDelFile,
    imported: deduped.length,
    competition,
    matchedBy,
    unmatched: unmatched.length,
    unmatchedSample: unmatched.slice(0, 12),
    season: effectiveStatsSeason,
    headers: parsed.headers,
  });
}
