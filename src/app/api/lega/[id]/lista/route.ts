import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { caricaListone, valutaListoneCompleto } from "@/lib/fanta/datiLega";
import { mercatoCorrente } from "@/lib/fanta/recommend";
import { buildMarketState } from "@/lib/fanta/market";
import { proponiLista, type CandidatoLista } from "@/lib/fanta/lista";
import { ROLE_LABEL, type LeagueRow, type ParticipantRow } from "@/lib/fanta/types";
import { conConsigli, livelloDa } from "@/lib/livelli";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * La lista ristretta: proporla, scaricarla, ricaricarla.
 *
 * L'asta di questa lega e' a chiamata casuale, e su cinquecentotrenta nomi
 * meta' del pomeriggio se ne va su giocatori che nessuno vuole. Si decide prima
 * chi puo' essere chiamato — di solito quanti bastano a riempire tutte le rose,
 * piu' un margine — e da li' in poi il software lavora solo su quelli.
 *
 * La proposta la fa il modello, ma **la lista la decide la lega**: si scarica,
 * si corregge in Excel e si ricarica. Per questo l'export porta l'Id ufficiale:
 * al ritorno l'abbinamento e' per identificativo, non per nome, e chi ha
 * scritto "Kone" invece di "Konè" non perde il giocatore.
 */

/**
 * Quanti in piu' dei necessari, se nessuno dice quanti.
 *
 * Una lista al minimo e' un'asta senza scelte: ogni squadra prende quello che
 * avanza. Un terzo in piu' e' abbastanza perche' chi perde un obiettivo abbia
 * dove ripiegare, e poco abbastanza perche' la chiamata resti corta.
 */
const EXTRA_PREDEFINITO = 0.35;

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
  const livello = livelloDa(profile ?? null);
  const { data: participants } = await supabase
    .from("participants")
    .select("*")
    .eq("league_id", idLega);

  return {
    supabase,
    user,
    league: league as LeagueRow,
    participants: (participants ?? []) as ParticipantRow[],
    livello,
    puoScrivere: league.owner_id === user.id || livello === "admin",
  };
}

/** GET: la lista di adesso, e la proposta se non c'e' ancora. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contesto(id);
  if (c.errore) return c.errore;
  const { supabase, league, participants, livello } = c;

  const { data: righe } = await supabase!
    .from("league_shortlist")
    .select("player_id")
    .eq("league_id", id);
  const scelti = new Set((righe ?? []).map((r) => r.player_id as string));

  const url = new URL(request.url);
  const vuoiExcel = url.searchParams.get("formato") === "xlsx";
  if (!vuoiExcel) {
    return NextResponse.json({ playerIds: [...scelti] });
  }
  if (!conConsigli(livello)) {
    return NextResponse.json({ error: "Serve un account premium." }, { status: 403 });
  }

  // Per l'Excel servono i prezzi e il mercato: si calcolano qui, sul server,
  // come ovunque.
  const players = await caricaListone(league!.season);
  const valutazioni = valutaListoneCompleto(players, league!, participants!);

  /**
   * Le squadre sono quelle **della lega**, non quelle iscritte finora.
   *
   * Il numero che conta e' quello delle regole: a un'asta di otto ci si presenta
   * in otto anche se in tre non hanno ancora aperto l'applicazione, e una lista
   * calcolata sui cinque iscritti lascerebbe tre rose senza giocatori.
   */
  const squadre = Math.max(participants!.length, league!.n_participants || 0, 1);

  const url2 = new URL(request.url);
  const extraPct = Number.isFinite(Number(url2.searchParams.get("extra")))
    ? Math.min(2, Math.max(0, Number(url2.searchParams.get("extra"))))
    : EXTRA_PREDEFINITO;

  // Il mercato come lo vede il motore: prezzi veri, non valori teorici.
  const state = buildMarketState({
    league: league!,
    participants: participants!,
    events: [],
    players: new Map(players.map((p) => [p.id, p])),
    valuations: valutazioni.byPlayer,
    myParticipantId: null,
  });
  const mercato = mercatoCorrente({
    state,
    valuations: valutazioni,
    allPlayers: players,
    strategyKey: "equilibrata",
  });
  const perId = new Map(players.map((p) => [p.id, p]));
  const candidati: CandidatoLista[] = mercato.map((c) => {
    const p = perId.get(c.id)!;
    return {
      ...c,
      team: p.team,
      quotazione: Number(p.quotation_current ?? 0),
      valore: Math.round(valutazioni.byPlayer.get(c.id)?.baseValue ?? 1),
    };
  });

  const esito = proponiLista({
    candidati,
    slots: league!.slots,
    squadre,
    crediti: league!.budget,
    extraPct,
  });

  const proposti = esito.scelti.map((c) => {
    const p = perId.get(c.id)!;
    return {
      Id: p.external_id ?? "",
      Ruolo: c.role,
      Nome: c.name,
      Squadra: c.team,
      Quotazione: c.quotazione || "",
      Valore: c.valore,
      "Prezzo atteso": c.prezzo,
      Presenze: Math.round(c.expApps),
      "In lista": scelti.size === 0 || scelti.has(c.id) ? "SI" : "NO",
    };
  });

  const wb = XLSX.utils.book_new();
  // Primo foglio: la proposta, una riga per giocatore, con la colonna da
  // cambiare. Si toglie scrivendo NO, o cancellando la riga: tutte e due
  // funzionano, perche' al ritorno conta solo chi e' rimasto con SI.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(proposti), "Lista");
  // Secondo foglio: **tutto** il listone, per poter aggiungere a mano chi la
  // proposta non aveva previsto senza andare a cercare come si scrive.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      players
        .slice()
        .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
        .map((p) => ({
          Id: p.external_id ?? "",
          Ruolo: p.role,
          RuoloEsteso: ROLE_LABEL[p.role],
          Nome: p.name,
          Squadra: p.team,
          Quotazione: p.quotation_current ?? "",
          Valore: Math.round(valutazioni.byPlayer.get(p.id)?.baseValue ?? 1),
          "In lista": scelti.has(p.id) ? "SI" : "",
        })),
    ),
    "Tutti i giocatori",
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="lista-asta-${league!.season}.xlsx"`,
    },
  });
}

/**
 * POST: sostituisce la lista.
 *
 * Due modi, lo stesso risultato: un file Excel appena corretto, oppure gli id
 * dei giocatori quando la scelta si fa a schermo. Sostituisce, non aggiunge: la
 * lista e' una fotografia, e "aggiungi" lascerebbe dentro chi era stato tolto.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contesto(id);
  if (c.errore) return c.errore;
  const { supabase, league, puoScrivere } = c;
  if (!puoScrivere) {
    return NextResponse.json(
      { error: "La lista la decide chi amministra la lega." },
      { status: 403 },
    );
  }

  /**
   * Ad asta iniziata la lista non si rifa'.
   *
   * Non e' una gentilezza verso l'interfaccia: chi ha pagato trenta crediti un
   * difensore perche' in quella fascia non ne restavano deve poter contare sul
   * fatto che nessuno la ripopoli a meta' asta. Aggiungere si', perche' toglie
   * niente a nessuno; sostituire no.
   */
  const { count: chiamate } = await supabase!
    .from("auction_events")
    .select("id", { count: "exact", head: true })
    .eq("league_id", id);
  const astaIniziata = (chiamate ?? 0) > 0;

  const tipo = request.headers.get("content-type") ?? "";
  let ids: string[] = [];
  let avvisi: string[] = [];

  const { data: listone } = await supabase!
    .from("players")
    .select("id, external_id, name, team, role")
    .eq("season", league!.season)
    .eq("is_active", true);
  const perId = new Map(
    (listone ?? [])
      .filter((p) => p.external_id != null)
      .map((p) => [Number(p.external_id), p.id as string]),
  );
  const chiave = (nome: string, squadra: string) =>
    `${nome}`.toLowerCase().replace(/[^a-z]/g, "") + "|" + `${squadra}`.toLowerCase().replace(/[^a-z]/g, "");
  const perNome = new Map((listone ?? []).map((p) => [chiave(p.name, p.team), p.id as string]));

  if (tipo.includes("multipart/form-data")) {
    if (astaIniziata) {
      return NextResponse.json(
        {
          error:
            "L'asta è cominciata: la lista non si può più sostituire. Si può solo aggiungere un giocatore alla volta.",
        },
        { status: 409 },
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante" }, { status: 400 });
    }
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const trovati = new Set<string>();
    let senzaRiscontro = 0;
    for (const nome of wb.SheetNames) {
      const righe = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nome]);
      for (const riga of righe) {
        // "In lista" vuota vale SI sul foglio della proposta e NO su quello di
        // tutti: la differenza la fa la colonna, non il foglio, quindi si
        // accetta solo un SI esplicito quando la colonna c'e'.
        const marcato = String(riga["In lista"] ?? riga["in lista"] ?? "").trim().toUpperCase();
        if ("In lista" in riga || "in lista" in riga) {
          if (marcato !== "SI" && marcato !== "SÌ" && marcato !== "X" && marcato !== "1") continue;
        }
        const idFile = Number(riga.Id ?? riga.id ?? 0);
        const daId = idFile ? perId.get(idFile) : undefined;
        const daNome = perNome.get(chiave(String(riga.Nome ?? riga.nome ?? ""), String(riga.Squadra ?? riga.squadra ?? "")));
        const trovato = daId ?? daNome;
        if (trovato) trovati.add(trovato);
        else if (riga.Nome || riga.nome) senzaRiscontro++;
      }
    }
    ids = [...trovati];
    if (senzaRiscontro > 0) {
      avvisi = [`${senzaRiscontro} righe senza riscontro nel listone: ignorate.`];
    }
  } else {
    const body = await request.json().catch(() => ({}));
    const richiesti: string[] = Array.isArray(body.playerIds) ? body.playerIds : [];
    const validi = new Set((listone ?? []).map((p) => p.id as string));
    ids = richiesti.filter((x) => validi.has(x));
    if (astaIniziata) {
      // Ad asta iniziata si puo' solo allargare: chi c'era resta.
      const { data: gia } = await supabase!
        .from("league_shortlist")
        .select("player_id")
        .eq("league_id", id);
      const prima = new Set((gia ?? []).map((r) => r.player_id as string));
      const tolti = [...prima].filter((x) => !ids.includes(x));
      if (tolti.length > 0) {
        return NextResponse.json(
          { error: "L'asta è cominciata: dalla lista non si può più togliere nessuno." },
          { status: 409 },
        );
      }
    }
  }

  await supabase!.from("league_shortlist").delete().eq("league_id", id);
  if (ids.length > 0) {
    const { error } = await supabase!
      .from("league_shortlist")
      .insert(ids.map((playerId) => ({ league_id: id, player_id: playerId })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ salvati: ids.length, avvisi });
}

/** DELETE: si torna a tutto il listone. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contesto(id);
  if (c.errore) return c.errore;
  if (!c.puoScrivere) {
    return NextResponse.json({ error: "La lista la decide chi amministra la lega." }, { status: 403 });
  }
  const { count: chiamate } = await c.supabase!
    .from("auction_events")
    .select("id", { count: "exact", head: true })
    .eq("league_id", id);
  if ((chiamate ?? 0) > 0) {
    return NextResponse.json(
      { error: "L'asta è cominciata: la lista non si può più togliere." },
      { status: 409 },
    );
  }
  await c.supabase!.from("league_shortlist").delete().eq("league_id", id);
  return NextResponse.json({ salvati: 0 });
}
