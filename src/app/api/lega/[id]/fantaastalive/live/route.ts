import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_DA_ZONA, type SegnalePonte } from "@/lib/fanta/ponte";
import type { LeagueRow } from "@/lib/fanta/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Quello che il ponte vede sul tabellone di FantaAstaLive.
 *
 * Chi chiama e' un pezzo di codice che gira dentro la pagina del tabellone, su
 * un altro dominio: non puo' portarsi dietro la sessione dell'utente, quindi si
 * presenta con il segreto della lega. A verificarlo e' qui, e la scrittura non
 * esce da questa route — al database non e' stato aperto niente.
 *
 * Due cose sole sa dire, e nient'altro puo' fare: chi e' sul piatto adesso, e
 * quali acquisti sono appena stati registrati di la'.
 */

/** Il tabellone sta la', e solo da la' ha senso che arrivino queste chiamate. */
const ORIGINE = "https://fanta-asta-live.fantacalcio.it";

function intestazioni() {
  return {
    "access-control-allow-origin": ORIGINE,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: intestazioni() });
}

function risposta(corpo: unknown, status = 200) {
  return NextResponse.json(corpo, { status, headers: intestazioni() });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let segnale: SegnalePonte;
  try {
    segnale = JSON.parse(await request.text());
  } catch {
    return risposta({ error: "corpo illeggibile" }, 400);
  }

  const token = String(segnale?.token ?? "");
  if (token.length < 24) return risposta({ error: "token mancante" }, 401);

  // Il service role serve perche' chi chiama non ha nessuna sessione: la RLS
  // qui non ha un utente su cui appoggiarsi. Il controllo lo fa il segreto.
  const supabase = createAdminClient();
  const { data: lega } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", id)
    .eq("bridge_token", token)
    .maybeSingle();
  if (!lega) return risposta({ error: "token non valido" }, 401);
  const league = lega as LeagueRow;

  const { data: listone } = await supabase
    .from("players")
    .select("id, external_id, role, name")
    .eq("season", league.season)
    .eq("is_active", true);
  type Riga = { id: string; role: string; name: string };
  const perEsterno = new Map(
    (listone ?? [])
      .filter((p) => p.external_id != null)
      .map((p) => [Number(p.external_id), p as Riga]),
  );
  /**
   * Per nome, perche' le colonne del tabellone scrivono quello.
   *
   * Si puo' fare senza rischio: confrontando la nostra anagrafica con la loro,
   * i 532 giocatori coincidevano senza una differenza. Accenti e maiuscole si
   * appianano lo stesso, che costa niente.
   */
  const pulisci = (x: string) =>
    x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const perNome = new Map<string, Riga>();
  for (const p of (listone ?? []) as Riga[]) {
    const k = pulisci(p.name);
    // Un nome ripetuto non e' abbinabile: meglio scartarlo che tirare a sorte.
    if (perNome.has(k)) perNome.set(k, null as unknown as Riga);
    else perNome.set(k, p);
  }

  /**
   * I nomi delle squadre, nell'ordine.
   *
   * Il ponte li usa per trovare le colonne sul tabellone: di la' non puo'
   * ricavarli da nessuna parte — l'archivio locale, su una scheda da
   * spettatore, ce li ha vuoti. Glieli diciamo noi, che siamo l'unico posto in
   * cui quei nomi sono certi, e sono gli stessi che il nostro file ha scritto
   * di la'.
   */
  const { data: partecipanti } = await supabase
    .from("participants")
    .select("id, name")
    .eq("league_id", id)
    .order("created_at", { ascending: true });

  const esito: Record<string, unknown> = {
    squadre: (partecipanti ?? []).map((p) => p.name as string),
  };

  /**
   * Il battito: l'applicazione deve sapere se il ponte e' vivo **adesso**.
   *
   * Si riscrive solo se e' vecchio di dieci secondi, non a ogni chiamata: ogni
   * scrittura sulla lega sveglia tutti i client in ascolto, e un battito al
   * secondo moltiplicato per otto schermi e' rumore inutile.
   */
  const visto = league.bridge_seen_at ? Date.parse(league.bridge_seen_at) : 0;
  if (Date.now() - visto > 10_000) {
    await supabase
      .from("leagues")
      .update({ bridge_seen_at: new Date().toISOString() })
      .eq("id", id);
  }

  // La diagnosi si deposita e non si guarda: serve a chi legge il database,
  // non al ponte. Non blocca niente, cosi' il ponte continua a lavorare anche
  // mentre si sta capendo perche' non legge.
  if (segnale.diagnosi !== undefined) {
    await supabase.from("leagues").update({ bridge_debug: segnale.diagnosi }).eq("id", id);
    esito.diagnosiRicevuta = true;
  }

  /**
   * I nomi che il ponte legge sul tabellone.
   *
   * Arrivano solo quando una colonna non si trova, e si depositano e basta:
   * l'aggancio lo decide una persona, dalla pagina della lista. Nessun nome
   * viene cambiato da qui — indovinare l'abbinamento fra due squadre vuol dire
   * scrivere gli acquisti di qualcuno nella rosa di un altro.
   */
  if (Array.isArray(segnale.squadreViste)) {
    // Un nome che sta nel listone non e' una squadra: e' un giocatore letto per
    // sbaglio. Succede quando la squadra si chiama come un numero e la riga del
    // nome viene scartata dal filtro delle cifre — il ponte allora prende la
    // prima riga buona, che e' il primo acquisto. Qui il listone ce l'abbiamo,
    // e quel caso si toglie di mezzo prima che diventi una proposta.
    const viste = segnale.squadreViste
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .filter((x) => !perNome.has(pulisci(x)))
      .slice(0, 24);
    const prima = Array.isArray(league.bridge_squadre) ? league.bridge_squadre : [];
    if (viste.join("|") !== prima.join("|")) {
      await supabase.from("leagues").update({ bridge_squadre: viste }).eq("id", id);
    }
    esito.squadreViste = viste.length;
  }

  // --- Chi e' sul piatto ---------------------------------------------------
  // Viene dal tabellone, non dal microfono: e' un fatto, non un'ipotesi, e si
  // segna come confermato perche' nessun altro lo sovrascriva.
  /**
   * Il piatto vuoto e' un fatto, non un silenzio.
   *
   * Quando di la' sospendono l'asta il giocatore chiamato sparisce dal
   * tabellone. Se qui restasse appeso, chi guarda il nostro schermo crederebbe
   * che l'asta e' ancora su di lui. Il ponte lo dichiara con `null`, e solo
   * dopo tre letture consecutive senza nessuno: un mezzo secondo di
   * ridisegno non deve chiudere una chiamata.
   */
  if (segnale.chiamato === null && league.current_player_id) {
    await supabase
      .from("leagues")
      .update({
        current_player_id: null,
        current_price: null,
        current_bidder: null,
        current_locked: false,
      })
      .eq("id", id);
    esito.piattoVuoto = true;
  }

  if (typeof segnale.chiamato === "number" && segnale.chiamato > 0) {
    const p = perEsterno.get(segnale.chiamato);
    if (!p) {
      esito.chiamatoIgnoto = segnale.chiamato;
    } else if (p.id !== league.current_player_id) {
      await supabase
        .from("leagues")
        .update({
          current_player_id: p.id,
          current_price: null,
          current_bidder: null,
          current_locked: true,
        })
        .eq("id", id);
      esito.chiamato = p.name;
    }
  }

  // --- Gli acquisti --------------------------------------------------------
  const acquisti = Array.isArray(segnale.acquisti) ? segnale.acquisti : [];
  if (acquisti.length > 0) {
    const { data: gia } = await supabase
      .from("auction_events")
      .select("player_id")
      .eq("league_id", id);
    const registrati = new Set((gia ?? []).map((r) => r.player_id as string));

    const nuovi: {
      league_id: string;
      player_id: string;
      participant_id: string;
      price: number;
      outcome: "assigned";
    }[] = [];
    const scartati: string[] = [];

    for (const a of acquisti) {
      const p = a.ext ? perEsterno.get(Number(a.ext)) : perNome.get(pulisci(String(a.nome ?? "")));
      const squadra = (partecipanti ?? [])[Number(a.squadra)];
      if (!p || !squadra) {
        scartati.push(`${a.nome ?? a.ext}: non riconosciuto`);
        continue;
      }
      // Se chi chiama dice anche il reparto, si controlla: e' la rete di
      // sicurezza per la vecchia strada, quella che deduceva il giocatore
      // invece di leggerne il nome. Meglio non registrare che sbagliare rosa.
      if (a.zona && ROLE_DA_ZONA[a.zona] !== p.role) {
        scartati.push(`${p.name}: il tabellone ha riempito ${a.zona}, lui è ${p.role}`);
        continue;
      }
      if (registrati.has(p.id)) continue;
      registrati.add(p.id);
      nuovi.push({
        league_id: id,
        player_id: p.id,
        participant_id: squadra.id as string,
        price: Math.max(0, Math.round(Number(a.prezzo) || 0)),
        outcome: "assigned",
      });
    }

    if (nuovi.length > 0) {
      const { error } = await supabase.from("auction_events").insert(nuovi);
      if (error) return risposta({ error: error.message }, 500);
      // Chiusa la chiamata, il piatto torna vuoto: il prossimo giro dira' chi
      // c'e' sopra adesso.
      await supabase
        .from("leagues")
        .update({
          current_player_id: null,
          current_price: null,
          current_bidder: null,
          current_locked: false,
        })
        .eq("id", id);
    }
    esito.registrati = nuovi.length;
    if (scartati.length > 0) esito.scartati = scartati;
  }

  /**
   * Le cancellazioni fatte sul tabellone.
   *
   * Un'aggiudicazione sbagliata, di la', si corregge togliendo il giocatore
   * dalla rosa. Se qui restasse, le due rose divergono — ed e' proprio il
   * guaio che il ponte esiste per evitare.
   *
   * Si cancella **solo** su una lettura completa: il ponte manda le rose
   * intere unicamente quando ha trovato tutte le colonne e ci ha letto
   * qualcosa. Una lettura parziale che sembrasse una rosa vuota cancellerebbe
   * un'asta intera, e questo e' il danno peggiore che potrebbe fare: meglio
   * una cancellazione che resta da sistemare a mano che dieci acquisti veri
   * buttati.
   */
  if (Array.isArray(segnale.rose) && segnale.rose.length > 0) {
    const aSchermo = new Map(
      segnale.rose.map((r) => [pulisci(String(r.nome ?? "")), r] as const),
    );
    const { data: nostri } = await supabase
      .from("auction_events")
      .select("id, player_id, participant_id, price, outcome")
      .eq("league_id", id)
      .eq("outcome", "assigned");
    const perId = new Map((listone ?? []).map((p) => [p.id as string, p as Riga]));
    const daTogliere = (nostri ?? []).filter((e) => {
      const p = perId.get(e.player_id as string);
      return p != null && !aSchermo.has(pulisci(p.name));
    });
    if (daTogliere.length > 0) {
      const { error } = await supabase
        .from("auction_events")
        .delete()
        .in(
          "id",
          daTogliere.map((e) => e.id as string),
        );
      if (!error) {
        esito.rimossi = daTogliere.length;
        esito.rimossiNomi = daTogliere.map((e) => perId.get(e.player_id as string)?.name);
      }
    }

    /**
     * Chi e' stato spostato di rosa, o corretto nella cifra.
     *
     * Sul tabellone si aggiusta un errore cosi': si prende il giocatore e lo
     * si mette nella squadra giusta, o gli si cambia il prezzo. Da noi non
     * arrivava niente — il giocatore c'era ancora, quindi non era una
     * cancellazione, ed era gia' registrato, quindi non era un acquisto: si
     * infilava esattamente in mezzo alle due porte, e l'assegnazione sbagliata
     * restava li'. Le rose intere dicono come stanno le cose adesso, e questo
     * e' l'unico posto da cui si puo' vedere.
     */
    const spostati: string[] = [];
    for (const e of nostri ?? []) {
      const p = perId.get(e.player_id as string);
      if (!p) continue;
      const suSchermo = aSchermo.get(pulisci(p.name));
      if (!suSchermo) continue;
      const squadra = (partecipanti ?? [])[Number(suSchermo.squadra)];
      if (!squadra) continue;
      const prezzo =
        typeof suSchermo.prezzo === "number"
          ? Math.max(0, Math.round(suSchermo.prezzo))
          : (e.price as number);
      if (squadra.id === e.participant_id && prezzo === e.price) continue;
      const { error } = await supabase
        .from("auction_events")
        .update({ participant_id: squadra.id as string, price: prezzo })
        .eq("id", e.id as string);
      if (error) continue;
      spostati.push(
        squadra.id === e.participant_id
          ? `${p.name}: ${e.price} → ${prezzo}`
          : `${p.name} → ${squadra.name}`,
      );
    }
    if (spostati.length > 0) {
      esito.spostati = spostati.length;
      esito.spostatiNomi = spostati;
    }
  }

  return risposta({ ok: true, ...esito });
}
