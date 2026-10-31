import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient, getProfile, getSessionUser } from "@/lib/supabase/server";
import { livelloDa, type Livello } from "@/lib/livelli";
import type { LeagueRow, ParticipantRow } from "@/lib/fanta/types";

export type ActiveStrategy = {
  id: string;
  key: string;
  label: string;
  budget_split: Record<string, number>;
  version: number;
  rationale: string | null;
  /** Quota massima del budget su un giocatore solo. `null` = lo decide il software. */
  max_quota_giocatore: number | null;
  /** La scala dei prezzi scritta a mano, reparto per reparto. */
  price_ladder: Record<string, number[]> | null;
} | null;

export type LeagueContext = {
  league: LeagueRow;
  participants: ParticipantRow[];
  me: ParticipantRow | null;
  isOwner: boolean;
  userId: string;
  /** Base, premium o amministratore: decide se si vedono i consigli. */
  livello: Livello;
  activeStrategy: ActiveStrategy;
};

/**
 * Tutto quello che serve a una pagina di lega, in un giro solo.
 *
 * Le tre query sono indipendenti e partono insieme: in fila costavano tre volte
 * la latenza verso il database. La strategia si aggancia al partecipante
 * dell'utente con una join, cosi' non deve aspettare di sapere chi e'.
 */
export const loadLeague = cache(async (leagueId: string): Promise<LeagueContext> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const [leagueRes, participantsRes, strategyRes, profilo] = await Promise.all([
    supabase.from("leagues").select("*").eq("id", leagueId).single(),
    supabase.from("participants").select("*").eq("league_id", leagueId).order("created_at"),
    supabase
      .from("strategies")
      .select("id, key, label, budget_split, version, rationale, max_quota_giocatore, price_ladder, participants!inner(user_id)")
      .eq("league_id", leagueId)
      .eq("is_active", true)
      .eq("participants.user_id", user.id)
      .maybeSingle(),
    getProfile(),
  ]);

  if (!leagueRes.data) notFound();

  const participants = (participantsRes.data ?? []) as ParticipantRow[];
  const me = participants.find((p) => p.user_id === user.id) ?? null;

  const strategy = strategyRes.data
    ? ({
        id: strategyRes.data.id,
        key: strategyRes.data.key,
        label: strategyRes.data.label,
        budget_split: strategyRes.data.budget_split,
        version: strategyRes.data.version,
        rationale: strategyRes.data.rationale,
        max_quota_giocatore: strategyRes.data.max_quota_giocatore ?? null,
        price_ladder: strategyRes.data.price_ladder ?? null,
      } as NonNullable<ActiveStrategy>)
    : null;

  return {
    league: leagueRes.data as LeagueRow,
    participants,
    me,
    isOwner: leagueRes.data.owner_id === user.id,
    userId: user.id,
    livello: livelloDa(profilo),
    activeStrategy: strategy,
  };
});
