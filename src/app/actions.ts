"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_RULES, DEFAULT_SLOTS, ROLES, type LeagueRules, type RoleMap } from "@/lib/fanta/types";
import { getStrategy, normalizeSplit } from "@/lib/fanta/strategies";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/**
 * Chi ha creato la lega, e chi no.
 *
 * Le regole del database bastano a impedire il danno, ma da sole lo fanno in
 * silenzio: PostgREST a una scrittura vietata risponde "zero righe toccate",
 * non un errore, e il modulo sembra aver salvato. Quindi il controllo si fa
 * anche qui, per poterlo dire.
 */
async function requireOwner(leagueId: string) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase.from("leagues").select("owner_id").eq("id", leagueId).single();
  if (!data || data.owner_id !== user.id) {
    throw new Error("Solo chi ha creato la lega può cambiare le squadre e le regole.");
  }
  return { supabase, user };
}

const num = (v: FormDataEntryValue | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export async function createLeague(formData: FormData) {
  const { supabase, user } = await requireUser();

  const rules: LeagueRules = {
    ...DEFAULT_RULES,
    defense_modifier: formData.get("defense_modifier") === "on",
    goalkeeper_modifier: formData.get("goalkeeper_modifier") === "on",
    assist_enabled: formData.get("assist_enabled") !== "off",
  };

  const { data, error } = await supabase
    .from("leagues")
    .insert({
      name: String(formData.get("name") || "La mia lega").slice(0, 60),
      owner_id: user.id,
      budget: Math.max(50, Math.round(num(formData.get("budget"), 500))),
      n_participants: Math.max(2, Math.min(20, Math.round(num(formData.get("n_participants"), 8)))),
      slots: DEFAULT_SLOTS,
      rules,
      season: "2026-27",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/");
  redirect(`/lega/${data.id}/impostazioni`);
}

export async function joinLeague(formData: FormData) {
  const { supabase } = await requireUser();
  const code = String(formData.get("code") || "").trim();
  const { data, error } = await supabase.rpc("join_league", { p_code: code });
  if (error) throw new Error(error.message);
  revalidatePath("/");
  redirect(`/lega/${data}/asta`);
}

export async function updateLeague(formData: FormData) {
  const leagueId = String(formData.get("league_id"));
  const { supabase } = await requireOwner(leagueId);

  const slots = {} as RoleMap<number>;
  for (const r of ROLES) slots[r] = Math.max(1, Math.round(num(formData.get(`slot_${r}`), DEFAULT_SLOTS[r])));

  const goalBonus = {} as RoleMap<number>;
  for (const r of ROLES) goalBonus[r] = num(formData.get(`goal_${r}`), DEFAULT_RULES.goal_bonus[r]);

  const rules: LeagueRules = {
    ...DEFAULT_RULES,
    defense_modifier: formData.get("defense_modifier") === "on",
    goalkeeper_modifier: formData.get("goalkeeper_modifier") === "on",
    assist_enabled: formData.get("assist_enabled") === "on",
    clean_sheet_bonus: num(formData.get("clean_sheet_bonus"), 0),
    goal_bonus: goalBonus,
    assist_bonus: num(formData.get("assist_bonus"), 1),
    yellow_card: num(formData.get("yellow_card"), -0.5),
    red_card: num(formData.get("red_card"), -1),
    goal_conceded: num(formData.get("goal_conceded"), -1),
  };

  // I prezzi dei piu' cari in un'asta passata, per tarare quanto il modello
  // concentra sui top. Si scrivono separati da virgola: "280, 240, 210".
  const budgetOra = Math.max(50, Math.round(num(formData.get("budget"), 500)));
  const grezzi = String(formData.get("top_prices") || "")
    .split(/[,;\s]+/)
    .map((v) => Math.round(Number(v.replace(",", "."))))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => b - a)
    .slice(0, 5);
  const budgetAllora = Math.max(50, Math.round(num(formData.get("top_prices_budget"), budgetOra)));
  const topPrices = grezzi.length > 0 ? { prices: grezzi, budget: budgetAllora } : null;

  // I crediti sono una regola della lega, non una proprieta' della singola
  // squadra: qui si decidono, e da qui scendono su tutti. Il pavimento e' quello
  // che qualcuno ha gia' speso — sotto, i suoi crediti residui andrebbero
  // negativi e con loro l'inflazione, il tetto degli avversari e ogni consiglio.
  const speso = await spesoMassimo(supabase, leagueId);
  const budgetVero = Math.max(budgetOra, speso);

  const { error } = await supabase
    .from("leagues")
    .update({
      name: String(formData.get("name") || "").slice(0, 60),
      budget: budgetVero,
      n_participants: Math.max(2, Math.min(20, Math.round(num(formData.get("n_participants"), 8)))),
      slots,
      rules,
      top_prices: topPrices,
      auction_format: String(formData.get("auction_format") || "chiamata"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leagueId);

  if (error) throw new Error(error.message);

  // Nessuna squadra puo' avere crediti diversi dagli altri: una lega con budget
  // disuguali non e' una regola, e' un errore che si nota tardi.
  await supabase
    .from("participants")
    .update({ budget_total: budgetVero })
    .eq("league_id", leagueId)
    .neq("budget_total", budgetVero);

  revalidatePath(`/lega/${leagueId}/impostazioni`);
  revalidatePath(`/lega/${leagueId}/asta`);
  revalidatePath(`/lega/${leagueId}/rose`);
}

/** Quanto ha speso, all'asta, la squadra che ha speso di piu'. */
async function spesoMassimo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueId: string,
): Promise<number> {
  const { data } = await supabase
    .from("auction_events")
    .select("participant_id, price")
    .eq("league_id", leagueId);
  const per = new Map<string, number>();
  for (const e of data ?? []) {
    if (!e.participant_id) continue;
    per.set(e.participant_id, (per.get(e.participant_id) ?? 0) + (e.price ?? 0));
  }
  return Math.max(0, ...per.values());
}

export async function startAuction(leagueId: string) {
  const { supabase } = await requireOwner(leagueId);
  await supabase.from("leagues").update({ status: "auction" }).eq("id", leagueId);
  redirect(`/lega/${leagueId}/asta`);
}

export async function addParticipant(formData: FormData) {
  const leagueId = String(formData.get("league_id"));
  const { supabase } = await requireOwner(leagueId);
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const { data: league } = await supabase.from("leagues").select("budget").eq("id", leagueId).single();
  await supabase.from("participants").insert({
    league_id: leagueId,
    name: name.slice(0, 40),
    budget_total: league?.budget ?? 500,
  });
  revalidatePath(`/lega/${leagueId}/impostazioni`);
}

export async function removeParticipant(formData: FormData) {
  const leagueId = String(formData.get("league_id"));
  const { supabase } = await requireOwner(leagueId);
  await supabase.from("participants").delete().eq("id", String(formData.get("participant_id")));
  revalidatePath(`/lega/${leagueId}/impostazioni`);
}

/**
 * Il nome della propria squadra. I crediti no: quelli sono una regola.
 *
 * Prima da qui si cambiavano anche i crediti, e ognuno poteva darsi il budget
 * che voleva. Non e' un'asta: i crediti li fissa chi ha creato la lega, nelle
 * regole, e scendono uguali su tutti.
 */
export async function updateMyTeamName(formData: FormData) {
  const { supabase } = await requireUser();
  const leagueId = String(formData.get("league_id"));
  await supabase
    .from("participants")
    .update({ name: String(formData.get("name") || "Io").trim().slice(0, 40) || "Io" })
    .eq("id", String(formData.get("participant_id")));
  revalidatePath(`/lega/${leagueId}/impostazioni`);
  revalidatePath(`/lega/${leagueId}/asta`);
}

/**
 * Rinominare una squadra invece di rifarla.
 *
 * Un nome storpiato si corregge spesso mentre l'asta sta per cominciare, e
 * rimuovere la squadra per rifarla vuol dire perdere quello che ha gia'
 * comprato.
 *
 * I crediti da qui non si toccano piu': sono una regola della lega, uguale per
 * tutti, e si cambiano nelle regole — dove valgono per chiunque invece che per
 * uno solo.
 */
export async function updateParticipant(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get("league_id") || "");
  const participantId = String(formData.get("participant_id") || "");
  let supabase;
  try {
    ({ supabase } = await requireOwner(leagueId));
  } catch (e) {
    return { error: (e as Error).message };
  }

  const name = String(formData.get("name") || "").trim().slice(0, 40);
  if (!name) return { error: "Il nome della squadra non può restare vuoto." };

  const { error } = await supabase
    .from("participants")
    .update({ name })
    .eq("id", participantId)
    .eq("league_id", leagueId);
  if (error) return { error: error.message };

  revalidatePath(`/lega/${leagueId}/impostazioni`);
  revalidatePath(`/lega/${leagueId}/asta`);
  revalidatePath(`/lega/${leagueId}/rose`);
  return { ok: `Adesso si chiama ${name}.` };
}

/**
 * Quanto puo' pesare un giocatore solo, nel piano.
 *
 * Sta sulla strategia attiva e non ne crea una nuova versione: non e' un
 * cambio di strategia, e' una manopola della stessa.
 */
export async function setQuotaGiocatore(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const leagueId = String(formData.get("league_id"));
  const participantId = String(formData.get("participant_id"));
  // Spento vuol dire "decidi tu": nel database e' `null`, non un numero che
  // sembra una scelta dell'utente e non lo e'.
  if (formData.get("attivo") !== "si") {
    const { error } = await supabase
      .from("strategies")
      .update({ max_quota_giocatore: null })
      .eq("participant_id", participantId)
      .eq("is_active", true);
    if (error) return { error: error.message };
    revalidatePath(`/lega/${leagueId}`, "layout");
    return { ok: "Il tetto lo decide il software." };
  }

  const quota = Number(formData.get("quota"));
  if (!Number.isFinite(quota) || quota <= 0 || quota > 1)
    return { error: "Tetto non valido." };

  const { error } = await supabase
    .from("strategies")
    .update({ max_quota_giocatore: quota })
    .eq("participant_id", participantId)
    .eq("is_active", true);
  if (error) return { error: error.message };

  revalidatePath(`/lega/${leagueId}`, "layout");
  return { ok: quota >= 1 ? "Nessun tetto." : `Al massimo il ${Math.round(quota * 100)}% su un giocatore.` };
}

/**
 * La scala dei prezzi scritta a mano: quanto sul 1°, sul 2°, sul 3°.
 *
 * Vince su tutto quello che il software deriverebbe da solo. Un campo vuoto
 * cancella la scala e si torna a quella derivata dalla strategia.
 */
export async function setScalaPrezzi(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const leagueId = String(formData.get("league_id"));
  const participantId = String(formData.get("participant_id"));

  if (formData.get("azzera") === "si") {
    const { error } = await supabase
      .from("strategies")
      .update({ price_ladder: null })
      .eq("participant_id", participantId)
      .eq("is_active", true);
    if (error) return { error: error.message };
    revalidatePath(`/lega/${leagueId}`, "layout");
    return { ok: "Scala rimessa a quella della strategia." };
  }

  const scala: Record<string, number[]> = {};
  let totale = 0;
  for (const r of ROLES) {
    const grezzi = String(formData.get(`scala_${r}`) || "")
      .split(/[,;\s]+/)
      .map((v) => Math.round(Number(v)))
      .filter((v) => Number.isFinite(v) && v >= 1);
    if (grezzi.length === 0) continue;
    scala[r] = grezzi.sort((a, b) => b - a);
    totale += grezzi.reduce((a, x) => a + x, 0);
  }
  if (Object.keys(scala).length === 0)
    return { error: "Scrivi almeno un reparto, con i prezzi separati da virgola." };

  const { data: p } = await supabase
    .from("participants")
    .select("budget_total")
    .eq("id", participantId)
    .single();
  const budget = p?.budget_total ?? 500;
  if (totale > budget)
    return { error: `La scala chiede ${totale} crediti e tu ne hai ${budget}.` };

  const { error } = await supabase
    .from("strategies")
    .update({ price_ladder: scala })
    .eq("participant_id", participantId)
    .eq("is_active", true);
  if (error) return { error: error.message };
  revalidatePath(`/lega/${leagueId}`, "layout");
  return { ok: `Scala salvata: ${totale} crediti su ${budget}.` };
}

/** Salva la strategia attiva: disattiva la precedente e ne crea una nuova versione. */
export async function setStrategy(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const leagueId = String(formData.get("league_id"));
  const participantId = String(formData.get("participant_id"));
  const key = String(formData.get("strategy_key"));
  const def = getStrategy(key);
  if (!def) return { error: "Strategia sconosciuta." };

  const custom = {} as RoleMap<number>;
  let hasCustom = false;
  for (const r of ROLES) {
    const raw = formData.get(`split_${r}`);
    if (raw !== null && raw !== "") {
      custom[r] = Number(raw) / 100;
      hasCustom = true;
    }
  }
  const split = hasCustom ? normalizeSplit(custom) : def.budgetSplit;

  const { data: last } = await supabase
    .from("strategies")
    .select("version")
    .eq("participant_id", participantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("strategies").update({ is_active: false }).eq("participant_id", participantId);
  const { error } = await supabase.from("strategies").insert({
    league_id: leagueId,
    participant_id: participantId,
    key: def.key,
    label: def.label,
    budget_split: split,
    tier_targets: def.topTargets,
    rationale: String(formData.get("rationale") || def.summary),
    version: (last?.version ?? 0) + 1,
    is_active: true,
  });
  if (error) return { error: error.message };
  revalidatePath(`/lega/${leagueId}`, "layout");
  return { ok: `Strategia salvata: ${def.label}.` };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Gestione account: niente registrazione pubblica, li crea l'amministratore.
// ---------------------------------------------------------------------------

export type AdminActionState = { ok?: string; error?: string } | null;

export async function adminCreateUser(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("display_name") || "").trim();
  // Un solo campo per tre livelli: "base" | "premium" | "admin".
  const livello = String(formData.get("livello") || "base");

  const { error } = await supabase.rpc("admin_create_user", {
    p_email: email,
    p_password: password,
    p_display_name: displayName || null,
    p_is_admin: livello === "admin",
    p_is_premium: livello !== "base",
  });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: `Account creato per ${email} (${livello}).` };
}

/**
 * Promuovere e retrocedere.
 *
 * Le due regole che contano stanno nel database, non qui: un amministratore e'
 * sempre premium, e nessuno puo' togliere l'amministrazione a se stesso — chi
 * lo facesse non potrebbe piu' ridarsela, e la lega resterebbe senza nessuno
 * che possa importare il listone.
 */
export async function adminSetLevel(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const livello = String(formData.get("livello") || "base");
  const { error } = await supabase.rpc("admin_set_level", {
    p_user_id: String(formData.get("user_id")),
    p_is_premium: livello !== "base",
    p_is_admin: livello === "admin",
  });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: `Livello aggiornato: ${livello}.` };
}

export async function adminSetPassword(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("admin_set_password", {
    p_user_id: String(formData.get("user_id")),
    p_password: String(formData.get("password") || ""),
  });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: "Password aggiornata." };
}

export async function changeOwnPassword(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const password = String(formData.get("password") || "");
  if (password.length < 8) return { error: "La password deve avere almeno 8 caratteri." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { ok: "Password cambiata." };
}

// ---------------------------------------------------------------------------
// Statistiche inserite a mano per chi giocava altrove.
// ---------------------------------------------------------------------------

export async function saveManualStats(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase } = await requireUser();
  const playerId = String(formData.get("player_id"));
  const season = String(formData.get("season") || "").trim();
  const competition = String(formData.get("competition") || "serie-a");
  if (!/^\d{4}-\d{2}$/.test(season)) return { error: "Stagione nel formato 2025-26." };

  const matches = Math.round(num(formData.get("matches"), 0));
  if (matches <= 0) return { error: "Servono le presenze." };

  const { error } = await supabase.from("player_stats").upsert(
    {
      player_id: playerId,
      season,
      competition,
      source: "manual",
      matches,
      minutes: Math.round(num(formData.get("minutes"), 0)) || null,
      rating: formData.get("rating") ? num(formData.get("rating"), 0) : null,
      avg_vote: null,
      avg_fantavote: null,
      goals: Math.round(num(formData.get("goals"), 0)),
      assists: Math.round(num(formData.get("assists"), 0)),
      own_goals: 0,
      yellow_cards: Math.round(num(formData.get("yellow_cards"), 0)),
      red_cards: 0,
      pen_scored: 0,
      pen_missed: 0,
      pen_saved: 0,
      goals_conceded: Math.round(num(formData.get("goals_conceded"), 0)),
      clean_sheets: 0,
    },
    { onConflict: "player_id,season,competition" },
  );
  if (error) return { error: error.message };
  revalidatePath("/lega", "layout");
  return { ok: `Statistiche salvate per ${season}.` };
}

// ---------------------------------------------------------------------------
// Gestione dei dati condivisi. Listone e statistiche sono globali: valgono per
// tutte le leghe, quindi solo un amministratore puo' cancellarli.
// ---------------------------------------------------------------------------

/**
 * La RLS bloccherebbe comunque chi non e' amministratore, ma restituendo "zero
 * righe cancellate" invece di un motivo: meglio dirlo.
 */
async function requireAdmin() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  return { supabase, isAdmin: !!profile?.is_admin };
}

/**
 * Cancella le statistiche di una stagione **caricate dai file ufficiali**.
 *
 * Non tocca quello che e' stato recuperato: le righe dell'archivio sportivo e
 * quelle ricostruite dal modello restano, e con loro i minuti, il rating e la
 * titolarita' con cui sono state arricchite le righe ufficiali.
 *
 * La distinzione conta perche' le due cose si rifanno in modo molto diverso.
 * Ricaricare un file dura dieci secondi; rifare un recupero costa un'ora di
 * quota dell'archivio e un dollaro e mezzo di modello. Cancellare le seconde
 * insieme alle prime, per ricaricare un file, era un prezzo nascosto dentro un
 * pulsante che sembrava innocuo.
 *
 * Con `tutto` si cancella davvero tutto, ma va chiesto.
 */
export async function deleteStatsSeason(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase, isAdmin } = await requireAdmin();
  if (!isAdmin) return { error: "Serve un account amministratore." };
  const season = String(formData.get("season") || "").trim();
  const competition = String(formData.get("competition") || "").trim();
  const tutto = String(formData.get("tutto") || "") === "si";
  if (!season) return { error: "Stagione mancante." };

  // Quante ne restano in piedi: serve a dirlo, non a decidere.
  const { count: recuperate } = await supabase
    .from("player_stats")
    .select("player_id", { count: "exact", head: true })
    .eq("season", season)
    .neq("source", "import");

  let query = supabase.from("player_stats").delete({ count: "exact" }).eq("season", season);
  if (competition) query = query.eq("competition", competition);
  if (!tutto) query = query.eq("source", "import");
  const { error, count } = await query;
  if (error) return { error: error.message };

  revalidatePath("/lega", "layout");
  const dove = `${season}${competition ? ` (${competition})` : ""}`;
  if (tutto) {
    return { ok: `Cancellate ${count ?? 0} righe di ${dove}, recuperi compresi.` };
  }
  return {
    ok:
      `Cancellate ${count ?? 0} righe ufficiali di ${dove}. Puoi ricaricare il file.` +
      (recuperate
        ? ` Le ${recuperate} righe recuperate da archivio e modello sono rimaste dov'erano.`
        : ""),
  };
}

/**
 * Cancella il listone di una stagione.
 *
 * Vietato se qualche asta ha gia' registrato acquisti: i giocatori sono
 * referenziati dalle rose, e toglierli sotto i piedi svuoterebbe le squadre.
 * Ad asta iniziata si aggiorna ricaricando il file, che e' un'operazione sicura.
 */
export async function deleteListone(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase, isAdmin } = await requireAdmin();
  if (!isAdmin) return { error: "Serve un account amministratore." };
  const season = String(formData.get("season") || "").trim();
  if (!season) return { error: "Stagione mancante." };

  const { data: players } = await supabase.from("players").select("id").eq("season", season);
  const ids = (players ?? []).map((p) => p.id);
  if (ids.length === 0) return { error: `Nessun listone da cancellare per ${season}.` };

  const { count: usati } = await supabase
    .from("auction_events")
    .select("id", { count: "exact", head: true })
    .in("player_id", ids);

  if ((usati ?? 0) > 0) {
    return {
      error:
        `Non si può cancellare: ci sono ${usati} acquisti registrati su questi giocatori. ` +
        `Ad asta iniziata il listone si aggiorna ricaricando il file ufficiale, che è sicuro.`,
    };
  }

  const { error, count } = await supabase
    .from("players")
    .delete({ count: "exact" })
    .eq("season", season);
  if (error) return { error: error.message };

  revalidatePath("/lega", "layout");
  return { ok: `Listone ${season} cancellato: ${count ?? 0} giocatori e le loro statistiche.` };
}

/**
 * Cancella una lega e tutto quello che le sta dentro.
 *
 * Solo chi l'ha creata. Partecipanti, acquisti, strategie e consigli spariscono
 * con lei per effetto delle chiavi esterne; listone e statistiche no, perche'
 * sono dati condivisi fra tutte le leghe.
 */
/**
 * Azzera l'asta, e solo l'asta.
 *
 * Serve per provare: si fa un giro di chiamate, si guarda come si comporta il
 * software, e si riparte da zero. Sparisce **solo** chi ha comprato chi — i
 * giocatori, le statistiche, le identita', le assenze, i rigoristi e le voci
 * restano dove sono, perche' quelli sono costati giorni e chiamate a pagamento
 * e non c'entrano niente con una prova.
 *
 * Le strategie restano: sono la tua idea di come giocare, non un risultato
 * dell'asta.
 */
export async function resetAuction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const leagueId = String(formData.get("league_id") || "");
  // `requireOwner` solleva: qui serve un messaggio, non una schermata di errore.
  let supabase;
  try {
    ({ supabase } = await requireOwner(leagueId));
  } catch (e) {
    return { error: (e as Error).message };
  }

  const { count, error } = await supabase
    .from("auction_events")
    .delete({ count: "exact" })
    .eq("league_id", leagueId);
  if (error) return { error: error.message };

  revalidatePath(`/lega/${leagueId}`, "layout");
  return {
    ok:
      (count ?? 0) === 0
        ? "L'asta era gia' vuota: non c'era niente da azzerare."
        : `Asta azzerata: ${count} chiamate cancellate. Giocatori, statistiche e voci sono rimasti.`,
  };
}

export async function deleteLeague(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const { supabase, user } = await requireUser();
  const leagueId = String(formData.get("league_id") || "");
  const conferma = String(formData.get("conferma") || "").trim();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, owner_id")
    .eq("id", leagueId)
    .single();
  if (!league) return { error: "Lega non trovata." };
  if (league.owner_id !== user.id) {
    return { error: "Solo chi ha creato la lega puo' cancellarla." };
  }
  if (conferma !== league.name) {
    return { error: `Per confermare scrivi il nome della lega: ${league.name}` };
  }

  const { error } = await supabase.from("leagues").delete().eq("id", leagueId);
  if (error) return { error: error.message };

  revalidatePath("/");
  redirect("/");
}
