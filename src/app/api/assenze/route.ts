import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiFootballConfig, fetchAssenzeStagione } from "@/lib/fanta/apiFootball";
import { budgetOra, dopoLaCorsa, readApiMemory, writeApiMemory } from "@/lib/apiState";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Quante partite ha saltato, e perche'.
 *
 * Dai conteggi delle presenze non si vede la differenza fra "non ha giocato
 * perche' era rotto" e "non ha giocato perche' l'allenatore ha scelto un
 * altro", e all'asta sono due cose molto diverse: la prima e' un rischio che si
 * ripete, la seconda una gerarchia che puo' cambiare in un'estate.
 *
 * L'archivio tiene una riga per giocatore e per partita saltata, con il motivo,
 * e le manda **tutte insieme senza paginare**: tremila righe per una stagione
 * intera di Serie A in una chiamata sola. E' il dato piu' economico che
 * abbiamo mai preso.
 *
 * Non e' lo stato fisico di oggi — il piano gratuito si ferma al 2024-25 — e
 * questo va detto, perche' e' la differenza fra "e' fragile" e "e' infortunato
 * adesso".
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Non autenticato" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: "Serve un amministratore." }, { status: 403 }) };
  }
  return { supabase };
}

/**
 * Cosa conta come infortunio.
 *
 * La fonte scrive il motivo in inglese e in libertà: "Ankle Injury", "Muscle
 * Injury", ma anche "Suspended" e "Coach's decision". Le squalifiche e le scelte
 * tecniche non sono fragilita' e non devono finire nello stesso numero.
 */
function eInfortunio(motivo: string): boolean {
  const m = motivo.toLowerCase();
  if (!m) return false;
  if (/suspend|red card|yellow card|disciplin|national team|personal|coach|rest/.test(m)) return false;
  return /injur|knock|strain|fracture|surgery|illness|virus|fitness|muscle|ligament|problem/.test(m);
}

async function leggiIdentita(supabase: Supabase) {
  const { data } = await supabase
    .from("player_identities")
    .select("player_id, api_player_id")
    .not("api_player_id", "is", null);
  return new Map(
    ((data ?? []) as { player_id: string; api_player_id: number }[]).map((i) => [
      i.api_player_id,
      i.player_id,
    ]),
  );
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const supabase = guard.supabase!;

  const body = await request.json().catch(() => ({}));
  // Il piano gratuito copre dal 2022 al 2024.
  const season = Math.min(2024, Math.max(2022, Number(body.season) || 2024));

  const cfg = apiFootballConfig();
  if (!cfg) return NextResponse.json({ error: "APIFOOTBALL_KEY non configurata." }, { status: 503 });

  let memoria = await readApiMemory(supabase);
  if (budgetOra(memoria) <= 0) {
    return NextResponse.json({
      season,
      calls: 0,
      messaggio:
        memoria.callsToday >= 100
          ? "Quota dell'archivio esaurita per oggi: si azzera a mezzanotte UTC."
          : "Limite al minuto: riprova fra un minuto.",
    });
  }

  const esito = await fetchAssenzeStagione(cfg, season);
  memoria = dopoLaCorsa(memoria, esito.calls, esito.error);
  await writeApiMemory(supabase, memoria);
  if (esito.error || !esito.data) {
    return NextResponse.json({ season, calls: esito.calls, error: esito.error }, { status: 502 });
  }

  const perApiId = await leggiIdentita(supabase);
  type Conto = { saltate: number; infortuni: number; motivi: Map<string, number> };
  const conti = new Map<string, Conto>();
  let fuoriListone = 0;

  for (const a of esito.data) {
    const playerId = perApiId.get(a.apiId);
    if (!playerId) {
      fuoriListone++;
      continue;
    }
    // Chi era solo "in dubbio" non ha saltato niente: contarlo gonfierebbe il
    // numero proprio sui giocatori di cui si parla di piu'.
    if (!a.saltata) continue;
    const c = conti.get(playerId) ?? { saltate: 0, infortuni: 0, motivi: new Map() };
    c.saltate++;
    if (eInfortunio(a.motivo)) {
      c.infortuni++;
      c.motivi.set(a.motivo, (c.motivi.get(a.motivo) ?? 0) + 1);
    }
    conti.set(playerId, c);
  }

  const stagione = `${season}-${String((season % 100) + 1).padStart(2, "0")}`;
  const righe = [...conti.entries()].map(([player_id, c]) => ({
    player_id,
    season: stagione,
    saltate: c.saltate,
    per_infortunio: c.infortuni,
    motivo_principale:
      [...c.motivi.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    fonte: "api",
    updated_at: new Date().toISOString(),
  }));

  let scritte = 0;
  for (let i = 0; i < righe.length; i += 200) {
    const { error } = await supabase
      .from("player_absences")
      .upsert(righe.slice(i, i + 200), { onConflict: "player_id,season" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    scritte += Math.min(200, righe.length - i);
  }

  return NextResponse.json({
    season: stagione,
    calls: esito.calls,
    quotaOggi: memoria.callsToday,
    righeLette: esito.data.length,
    fuoriListone,
    giocatori: righe.length,
    scritte,
    conInfortuni: righe.filter((r) => r.per_infortunio > 0).length,
  });
}
