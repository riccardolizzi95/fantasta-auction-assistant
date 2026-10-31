import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { caricaListone, valutaListoneCompleto } from "@/lib/fanta/datiLega";
import {
  abbinaSquadre,
  csvListaCalciatori,
  csvRose,
  leggiRose,
  savSquadre,
} from "@/lib/fanta/fantaastalive";
import { preferitoDelPonte } from "@/lib/fanta/ponte";
import type { AuctionEventRow, LeagueRow, ParticipantRow } from "@/lib/fanta/types";
import { conConsigli, livelloDa } from "@/lib/livelli";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Il ponte verso FantaAstaLive.
 *
 * Il tabellone di Fantacalcio.it non ha API: quello che si puo' fare e'
 * scrivergli file che sa leggere e rileggere quelli che scrive lui. Qui ci sono
 * i due versi del ponte — la lista calciatori e le rose — piu' il ritorno delle
 * rose dentro la nostra asta.
 *
 * Il formato sta in `src/lib/fanta/fantaastalive.ts`, letto nel loro codice e
 * riverificato da `npm run check:fantaastalive`.
 */

async function contesto(idLega: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { errore: NextResponse.json({ error: "Non autenticato" }, { status: 401 }) };

  const { data: league } = await supabase.from("leagues").select("*").eq("id", idLega).single();
  if (!league) return { errore: NextResponse.json({ error: "Lega non trovata" }, { status: 404 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_premium")
    .eq("id", user.id)
    .maybeSingle();
  const { data: participants } = await supabase
    .from("participants")
    .select("*")
    .eq("league_id", idLega)
    .order("created_at", { ascending: true });

  const livello = livelloDa(profile ?? null);
  return {
    supabase,
    user,
    league: league as LeagueRow,
    participants: (participants ?? []) as ParticipantRow[],
    livello,
    puoScrivere: league.owner_id === user.id || livello === "admin",
  };
}

function csv(testo: string, nome: string, saltate: string[] = []) {
  // Il loro lettore fa `readAsText(file, "UTF-8")`: il BOM finirebbe dentro il
  // primo identificativo e la prima riga verrebbe scartata. Niente BOM.
  const headers: Record<string, string> = {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${nome}"`,
  };
  // Chi non entra nel file lo deve sapere **prima** di caricarlo di la', non
  // dopo aver visto sparire una squadra dal tabellone: il formato ricava le
  // squadre dalle righe dei giocatori, e una rosa vuota non produce righe.
  if (saltate.length > 0) headers["x-squadre-saltate"] = encodeURIComponent(saltate.join(", "));
  return new NextResponse(testo, { headers });
}

/** GET: i due file da caricare in FantaAstaLive. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contesto(id);
  if (c.errore) return c.errore;
  const { supabase, league, participants, livello } = c;

  const url = new URL(request.url);
  const cosa = url.searchParams.get("cosa") ?? "lista";

  /**
   * Il ponte: il segreto e il preferito da installare.
   *
   * Lo vede solo chi amministra la lega, perche' con quel segreto si dice alla
   * lega chi e' in asta e si registrano acquisti. Rigenerarlo spegne il ponte
   * acceso altrove: e' anche il modo di revocarlo.
   */
  if (cosa === "ponte") {
    if (!c.puoScrivere) {
      return NextResponse.json({ error: "Il ponte lo accende chi amministra." }, { status: 403 });
    }
    let token = league!.bridge_token ?? null;
    if (!token || url.searchParams.get("rigenera") === "1") {
      token = randomBytes(24).toString("base64url");
      const { error } = await supabase!
        .from("leagues")
        .update({ bridge_token: token })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const base = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
    return NextResponse.json({ preferito: preferitoDelPonte(base, id, token) });
  }

  // Le squadre da sole, prima che l'asta cominci: il CSV delle rose non sa
  // scrivere una squadra che non ha comprato nessuno, il file di salvataggio si.
  if (cosa === "squadre") {
    if (participants!.length === 0) {
      return NextResponse.json({ error: "Non c'è ancora nessuna squadra." }, { status: 409 });
    }
    const testo = savSquadre(participants!.map((p) => p.name));
    return new NextResponse(testo, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="squadre-${league!.season}.sav"`,
      },
    });
  }

  if (cosa === "rose") {
    const { data: eventi } = await supabase!
      .from("auction_events")
      .select("*")
      .eq("league_id", id)
      .eq("outcome", "assigned")
      .order("created_at", { ascending: true });
    const { data: listone } = await supabase!
      .from("players")
      .select("id, external_id")
      .eq("season", league!.season);
    const esterno = new Map(
      (listone ?? []).map((p) => [p.id as string, p.external_id as number | null]),
    );
    const perSquadra = new Map<string, { playerId: number; prezzo: number }[]>();
    for (const e of (eventi ?? []) as AuctionEventRow[]) {
      if (!e.participant_id) continue;
      const ext = esterno.get(e.player_id);
      if (ext == null) continue;
      perSquadra.set(e.participant_id, [
        ...(perSquadra.get(e.participant_id) ?? []),
        { playerId: ext, prezzo: e.price },
      ]);
    }
    const testo = csvRose(
      participants!.map((p) => ({ nome: p.name, acquisti: perSquadra.get(p.id) ?? [] })),
    );
    // Un file senza nemmeno un acquisto, di la', non crea niente: il loro
    // lettore ricava le squadre dalle righe dei giocatori. Meglio dirlo qui che
    // far scaricare un file che non fa niente.
    if (!testo) {
      return NextResponse.json(
        {
          error:
            "Non c'è ancora nessun acquisto da esportare: questo file porta di là le assegnazioni, e FantaAstaLive ricava le squadre proprio da quelle. Per creare le squadre prima dell'asta usa «Squadre».",
        },
        { status: 409 },
      );
    }
    return csv(
      testo,
      `rose-${league!.season}.csv`,
      participants!.filter((p) => (perSquadra.get(p.id) ?? []).length === 0).map((p) => p.name),
    );
  }

  // La lista calciatori: i prezzi del motore li vede solo chi ha i consigli, e
  // qui dentro ci finiscono se si chiede l'ordinamento nostro.
  const nostroFvm = url.searchParams.get("fvm") === "nostro";
  if (nostroFvm && !conConsigli(livello)) {
    return NextResponse.json({ error: "Serve un account premium." }, { status: 403 });
  }

  const players = await caricaListone(league!.season);
  const { data: righe } = await supabase!
    .from("league_shortlist")
    .select("player_id")
    .eq("league_id", id);
  const scelti = new Set((righe ?? []).map((r) => r.player_id as string));
  // Senza lista ristretta si esporta tutto il listone: e' la stessa regola che
  // vale ovunque nell'applicazione, "nessuna lista" vuol dire "tutti".
  const dentro = scelti.size > 0 ? players.filter((p) => scelti.has(p.id)) : players;

  let valori: Map<string, number> | undefined;
  if (nostroFvm) {
    const valutazioni = valutaListoneCompleto(players, league!, participants!);
    valori = new Map(
      [...valutazioni.byPlayer].map(([pid, v]) => [pid, Math.round(v.baseValue)]),
    );
  }

  const testo = csvListaCalciatori(dentro, {
    fvm: nostroFvm ? "nostro" : "ufficiale",
    valori,
  });
  return csv(testo, `lista-calciatori-${league!.season}.csv`);
}

/**
 * POST: le rose esportate da FantaAstaLive tornano dentro la nostra asta.
 *
 * Serve quando l'asta la batte il tabellone e noi facciamo da consiglio: senza
 * questo, meta' pomeriggio i nostri consigli ragionano su una rosa che non
 * esiste piu'. Registra solo gli acquisti che mancano — chi c'e' gia' non viene
 * toccato — cosi' il file si puo' ricaricare quante volte si vuole.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contesto(id);
  if (c.errore) return c.errore;
  const { supabase, league, participants, puoScrivere } = c;
  if (!puoScrivere) {
    return NextResponse.json(
      { error: "Le rose le aggiorna chi amministra la lega." },
      { status: 403 },
    );
  }

  const tipo = request.headers.get("content-type") ?? "";
  let testo = "";
  if (tipo.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante" }, { status: 400 });
    }
    testo = await file.text();
  } else {
    testo = await request.text();
  }

  const acquisti = leggiRose(testo);
  if (!acquisti) {
    return NextResponse.json(
      {
        error:
          "Non sembra un file di rose di FantaAstaLive: la prima riga dovrebbe essere $,$,$",
      },
      { status: 400 },
    );
  }

  const abbinate = abbinaSquadre([...new Set(acquisti.map((a) => a.squadra))], participants!);
  const { data: listone } = await supabase!
    .from("players")
    .select("id, external_id")
    .eq("season", league!.season);
  const perEsterno = new Map(
    (listone ?? [])
      .filter((p) => p.external_id != null)
      .map((p) => [Number(p.external_id), p.id as string]),
  );

  const { data: gia } = await supabase!
    .from("auction_events")
    .select("player_id")
    .eq("league_id", id);
  const registrati = new Set((gia ?? []).map((r) => r.player_id as string));

  const nuovi: { league_id: string; player_id: string; participant_id: string; price: number; outcome: "assigned" }[] = [];
  let senzaSquadra = 0;
  let senzaGiocatore = 0;
  for (const a of acquisti) {
    const partecipante = abbinate.get(a.squadra);
    if (!partecipante) {
      senzaSquadra++;
      continue;
    }
    const playerId = perEsterno.get(a.playerId);
    if (!playerId) {
      senzaGiocatore++;
      continue;
    }
    if (registrati.has(playerId)) continue;
    registrati.add(playerId);
    nuovi.push({
      league_id: id,
      player_id: playerId,
      participant_id: partecipante.id,
      price: a.prezzo,
      outcome: "assigned",
    });
  }

  if (nuovi.length > 0) {
    const { error } = await supabase!.from("auction_events").insert(nuovi);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const squadreIgnote = [...new Set(acquisti.map((a) => a.squadra))].filter(
    (n) => !abbinate.has(n),
  );
  return NextResponse.json({
    registrati: nuovi.length,
    gia: acquisti.length - nuovi.length - senzaSquadra - senzaGiocatore,
    senzaSquadra,
    senzaGiocatore,
    squadreIgnote,
  });
}
