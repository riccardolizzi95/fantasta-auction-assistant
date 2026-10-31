/**
 * La carriera di chi arriva da fuori: quanto ne sappiamo, e quanto era falso.
 *
 * Confronta quello che abbiamo in archivio con quello che dice Wikidata, che
 * non stima ma cita. Senza argomenti misura e basta; con `--scrivi` sostituisce
 * le righe inventate con quelle citate.
 *
 *   npm run check:carriera
 *   npm run check:carriera -- --scrivi
 */
import { createClient } from "@supabase/supabase-js";
import {
  carrieraQuery,
  chiediAWikidata,
  etichettaStagione,
  parseCarriera,
  parseQid,
  qidQuery,
  righeCarriera,
  type RigaCarriera,
} from "../src/lib/fanta/carriera";
import { abbinaRosa, punteggioSquadra } from "../src/lib/fanta/rosters";
import { parseRoster, rosterQuery, soloClubPiuRecente } from "../src/lib/fanta/wikidata";

// Node 20 non ha WebSocket nativo e supabase-js lo pretende.
import WebSocketLib from "ws";
(globalThis as { WebSocket?: unknown }).WebSocket ??= WebSocketLib;

const SCRIVI = process.argv.includes("--scrivi");
const STAGIONE = "2026-27";
const ANNO_CORRENTE = 2026;

type Player = {
  id: string;
  name: string;
  team: string;
  quotation_current: number | null;
  player_identities: { full_name: string | null } | null;
  player_stats: { season: string; source: string | null }[];
  player_career: { season: string; club: string | null; competition: string | null; source: string | null }[];
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").trim();

/** Due nomi di club sono lo stesso club se uno contiene la parola forte dell'altro. */
function stessoClub(a: string, b: string): boolean {
  const pa = norm(a).split(/\s+/).filter((w) => w.length > 3);
  const pb = norm(b).split(/\s+/).filter((w) => w.length > 3);
  if (pa.length === 0 || pb.length === 0) return norm(a) === norm(b);
  return pa.some((w) => pb.includes(w));
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: errLogin } = await sb.auth.signInWithPassword({
    email: process.env.TEST_EMAIL!,
    password: process.env.TEST_PASSWORD!,
  });
  if (errLogin) throw new Error(`login: ${errLogin.message}`);

  const { data, error } = await sb
    .from("players")
    .select(
      "id,name,team,quotation_current,player_identities(full_name),player_stats(season,source),player_career(season,club,competition,source)",
    )
    .eq("season", STAGIONE)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  const tutti = (data ?? []) as unknown as Player[];

  // Chi ci interessa: chi non ha una riga dal file ufficiale dell'anno scorso.
  // Per gli altri la Serie A la sappiamo gia', e Wikidata non aggiunge niente.
  const bersagli = tutti
    .filter((p) => !p.player_stats.some((s) => s.season === "2025-26" && s.source === "import"))
    .sort((a, b) => (b.quotation_current ?? 0) - (a.quotation_current ?? 0));
  console.log(`Listone ${tutti.length}. Senza una riga ufficiale 2025-26: ${bersagli.length}.`);

  // ------------------------------------------------------------------ i QID
  const nomiDi = (p: Player) => [p.player_identities?.full_name, p.name].filter(Boolean).map(String);
  const nomi = [...new Set(bersagli.flatMap(nomiDi))];
  const qidPerNome = new Map<string, string>();
  for (let i = 0; i < nomi.length; i += 60) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700));
    const j = await chiediAWikidata(qidQuery(nomi.slice(i, i + 60)));
    for (const [n, q] of parseQid(j)) qidPerNome.set(n, q);
  }
  const qidDi = new Map<string, string>();
  for (const p of bersagli) {
    const n = nomiDi(p).find((x) => qidPerNome.has(x));
    if (n) qidDi.set(p.id, qidPerNome.get(n)!);
  }
  const perNome = qidDi.size;

  /**
   * Chi non ha un nome per esteso non si trova per etichetta.
   *
   * "Kolo Muani", "Vicario", "Stones": nel listone c'e' solo il cognome, e su
   * Wikidata l'etichetta e' il nome intero. Per loro si passa dall'altra
   * porta — le rose dei club di Serie A, che Wikidata ha gia' — e si abbina
   * per cognome dentro la squadra, che e' lo stesso metodo con cui il progetto
   * abbina le rose ufficiali.
   */
  const senzaQid = bersagli.filter((p) => !qidDi.has(p.id));
  if (senzaQid.length > 0) {
    const rosa = soloClubPiuRecente(parseRoster(await chiediAWikidata(rosterQuery())));
    const perSquadra = new Map<string, typeof rosa>();
    for (const v of rosa) perSquadra.set(v.club, [...(perSquadra.get(v.club) ?? []), v]);
    for (const p of senzaQid) {
      // La squadra del listone e quella di Wikidata si chiamano in modo diverso
      // ("Inter" contro "Football Club Internazionale Milano"): il punteggio
      // che le confronta e' lo stesso usato per le rose ufficiali.
      let miglioreClub: string | null = null;
      let migliore = 0;
      for (const club of perSquadra.keys()) {
        const q = punteggioSquadra(p.team, club);
        if (q > migliore) {
          migliore = q;
          miglioreClub = club;
        }
      }
      // `punteggioSquadra` va da 0 a 3: 3 e' identico, 2 e' "Hellas Verona" per
      // "Verona". Sotto il 2 non ci si fida.
      if (!miglioreClub || migliore < 2) continue;
      const voci = perSquadra.get(miglioreClub) ?? [];
      const esito = abbinaRosa(
        [{ id: p.id, name: p.name, team: p.team }],
        voci.map((v) => ({ id: v.qid, name: v.fullName })),
      );
      const trovato = esito.trovati[0];
      if (trovato) qidDi.set(p.id, trovato.id);
    }
  }
  console.log(
    `Trovati su Wikidata: ${qidDi.size}/${bersagli.length} ` +
      `(${perNome} per nome, ${qidDi.size - perNome} dalle rose dei club).`,
  );

  // ------------------------------------------------------------- le carriere
  const qids = [...new Set(qidDi.values())];
  const tappe = [];
  for (let i = 0; i < qids.length; i += 40) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700));
    const j = await chiediAWikidata(carrieraQuery(qids.slice(i, i + 40)));
    tappe.push(...parseCarriera(j));
  }
  const perQid = new Map<string, typeof tappe>();
  for (const t of tappe) perQid.set(t.qid, [...(perQid.get(t.qid) ?? []), t]);
  console.log(`Tesseramenti letti: ${tappe.length}.`);

  // ------------------------------------------------------------- il confronto
  let concordi = 0;
  let eco = 0;
  let incerti = 0;
  let nuove = 0;
  const esempi: string[] = [];
  const daScrivere: (RigaCarriera & { player_id: string })[] = [];

  for (const p of bersagli) {
    const qid = qidDi.get(p.id);
    if (!qid) continue;
    const righe = righeCarriera(perQid.get(qid) ?? [], ANNO_CORRENTE);
    if (righe.length === 0) continue;
    for (const r of righe) {
      // La stagione in corso la sappiamo dal listone e Wikidata e' spesso
      // indietro di un mercato: non la si tocca.
      if (r.season === STAGIONE) continue;
      const nostra = p.player_career.filter((c) => c.season === r.season);
      if (nostra.length === 0) nuove++;
      else if (nostra.some((c) => c.club && stessoClub(c.club, r.club))) concordi++;
      else if (nostra.some((c) => c.club && stessoClub(c.club, p.team))) {
        // Il modo in cui un modello sbaglia quando non sa: ripete la squadra di
        // adesso. Qui non c'e' dubbio interpretativo — nel 2023 non giocava
        // nella squadra che l'ha comprato nel 2026.
        eco++;
        if (esempi.length < 10) {
          esempi.push(
            `${p.name}: ${r.season} in archivio "${nostra[0].club}" (che e' la squadra di adesso), ` +
              `su Wikidata "${r.club}"${r.competition !== "sconosciuta" ? ` — ${r.competition}` : ""}`,
          );
        }
      } else incerti++;
      daScrivere.push({ ...r, player_id: p.id });
    }
  }

  console.log("\n== Quanto era giusto quello che avevamo ==");
  console.log(`  stessa squadra:                 ${concordi}`);
  console.log(`  eco della squadra di adesso:    ${eco}   (sbagliate di sicuro)`);
  console.log(`  nomi diversi, dubbio:           ${incerti}   (puo' essere lo stesso club scritto in un'altra lingua)`);
  console.log(`  stagioni che non avevamo:       ${nuove}`);
  const confrontabili = concordi + eco + incerti;
  if (confrontabili > 0) {
    console.log(
      `  almeno il ${Math.round((eco / confrontabili) * 100)}% delle stagioni confrontabili era la squadra sbagliata`,
    );
  }
  for (const e of esempi) console.log(`   - ${e}`);

  if (!SCRIVI) {
    console.log(`\n${daScrivere.length} righe pronte. Rilancia con --scrivi per salvarle.`);
    return;
  }

  // ------------------------------------------------------------- la scrittura
  //
  // Le righe citate prendono il posto di quelle a memoria: si cancellano le
  // stagioni interessate e si riscrivono. Non si tocca la stagione in corso, e
  // non si toccano le righe che non vengono da un modello — se un giorno
  // arrivera' una fonte migliore, questa le lascera' stare.
  let scritte = 0;
  const perGiocatore = new Map<string, (RigaCarriera & { player_id: string })[]>();
  for (const r of daScrivere) perGiocatore.set(r.player_id, [...(perGiocatore.get(r.player_id) ?? []), r]);

  for (const [playerId, righe] of perGiocatore) {
    const stagioni = [...new Set(righe.map((r) => r.season))];
    await sb
      .from("player_career")
      .delete()
      .eq("player_id", playerId)
      .in("season", stagioni)
      .in("source", ["ai", "wikidata"]);
    const { error: errIns } = await sb.from("player_career").insert(
      righe.map((r) => ({
        player_id: playerId,
        season: r.season,
        club: r.club,
        competition: r.competition,
        country: r.country,
        status: r.status,
        matches: r.matches,
        goals: r.goals,
        is_debut: false,
        source: "wikidata",
        confidence: "alta",
        note: "tesseramento dichiarato su Wikidata",
      })),
    );
    if (errIns) console.log(`  ! ${playerId}: ${errIns.message}`);
    else scritte += righe.length;
  }
  // ------------------------------------------------- e le statistiche a memoria
  //
  // Le righe di statistiche scritte da un modello dichiarano anche un
  // campionato, e quel campionato decide il coefficiente di conversione: dare
  // la Serie A a chi giocava in Segunda gli regala mezzo punto di fantamedia.
  // Dove la carriera citata dice un'altra cosa, comanda lei.
  let corrette = 0;
  let cancellate = 0;
  const { data: righeAi } = await sb
    .from("player_stats")
    .select("id,player_id,season,competition,club,source")
    .in("player_id", [...perGiocatore.keys()])
    .eq("source", "ai");
  for (const riga of (righeAi ?? []) as {
    id: string;
    player_id: string;
    season: string;
    competition: string | null;
    club: string | null;
    source: string;
  }[]) {
    const citate = (perGiocatore.get(riga.player_id) ?? []).filter((r) => r.season === riga.season);
    if (citate.length === 0) continue;
    // Con due squadre nella stessa stagione comanda quella con un campionato
    // riconosciuto: fra "Villarreal" e "Villarreal B" la riga buona e' la prima.
    const vera = citate.find((r) => r.competition !== "sconosciuta") ?? citate[0];
    const italiano = (vera.country ?? "").toLowerCase().startsWith("ital");
    // Il campionato: quello citato se lo conosciamo; altrimenti, se la riga a
    // memoria diceva Serie A e il giocatore era all'estero, meglio ammettere di
    // non sapere che regalargli il coefficiente del nostro campionato.
    const competition =
      vera.competition !== "sconosciuta"
        ? vera.competition
        : riga.competition === "serie-a" && !italiano
          ? "sconosciuta"
          : riga.competition;
    if (competition === riga.competition && (riga.club || !vera.club)) continue;
    const { error: errUp } = await sb
      .from("player_stats")
      .update({ competition, club: vera.club })
      .eq("id", riga.id);
    if (errUp) {
      // La chiave esiste gia' con quel campionato: la riga a memoria e' di
      // troppo, non c'e' niente da salvare.
      await sb.from("player_stats").delete().eq("id", riga.id);
      cancellate++;
    } else corrette++;
  }

  // ------------------------------------------------ i numeri, dove ci sono
  //
  // Wikidata riporta presenze e gol del periodo. Dove il periodo copre una
  // stagione sola quei numeri sono di quella stagione, e allora sono una riga
  // di storico vera: meglio "29 presenze e 5 gol in Segunda" che un buco, anche
  // senza media voto — la fantamedia la ricostruisce il convertitore dai bonus,
  // come per ogni altro campionato straniero.
  //
  // Non si tocca mai una stagione che ha una riga dai file ufficiali: quella e'
  // la verita', e questa e' un'enciclopedia.
  let numeri = 0;
  const { data: presenti } = await sb
    .from("player_stats")
    .select("player_id,season,competition,club,source")
    .in("player_id", [...perGiocatore.keys()]);
  const chiaviPresenti = new Set(
    ((presenti ?? []) as { player_id: string; season: string; competition: string; club: string | null }[]).map(
      (r) => `${r.player_id}|${r.season}|${r.competition}|${r.club ?? ""}`,
    ),
  );
  // Una stagione dove c'e' gia' una fonte piu' affidabile — il file ufficiale o
  // l'archivio sportivo — non si tocca: due righe con due squadre diverse per
  // la stessa stagione non sono due mezze stagioni, sono un disaccordo, e il
  // motore le sommerebbe.
  const stagioniUfficiali = new Set(
    ((presenti ?? []) as { player_id: string; season: string; competition: string; source: string | null }[])
      .filter((r) => r.source === "import" || r.source === "api" || r.source === "manual")
      .map((r) => `${r.player_id}|${r.season}|${r.competition}`),
  );
  const righeNumeri = daScrivere
    .filter((r) => (r.matches ?? 0) > 0)
    .filter((r) => !stagioniUfficiali.has(`${r.player_id}|${r.season}|${r.competition}`))
    .filter((r) => !chiaviPresenti.has(`${r.player_id}|${r.season}|${r.competition}|${r.club}`))
    .map((r) => ({
      player_id: r.player_id,
      season: r.season,
      competition: r.competition,
      club: r.club,
      source: "wikidata",
      matches: r.matches ?? 0,
      goals: r.goals ?? 0,
      assists: 0,
      own_goals: 0,
      yellow_cards: 0,
      red_cards: 0,
      pen_scored: 0,
      pen_missed: 0,
      pen_saved: 0,
      goals_conceded: 0,
      clean_sheets: 0,
      minutes: null,
      avg_vote: null,
      avg_fantavote: null,
      source_detail: { provider: "wikidata", note: "presenze e gol dichiarati sul tesseramento" },
    }));
  if (righeNumeri.length > 0) {
    const { error: errNum } = await sb
      .from("player_stats")
      .upsert(righeNumeri, { onConflict: "player_id,season,competition,club" });
    if (errNum) console.log(`  ! statistiche non salvate: ${errNum.message}`);
    else numeri = righeNumeri.length;
  }

  console.log(`\nScritte ${scritte} righe di carriera da Wikidata.`);
  console.log(`Stagioni con presenze e gol recuperati: ${numeri}.`);
  console.log(`Statistiche a memoria corrette nel campionato o nella squadra: ${corrette}, doppioni tolti: ${cancellate}.`);
  console.log(`Stagioni coperte: ${[...new Set(daScrivere.map((r) => r.season))].sort().join(", ")}`);
  console.log(`(la stagione in corso ${etichettaStagione(ANNO_CORRENTE)} resta com'era: Wikidata e' spesso indietro di un mercato)`);
}

void main();
