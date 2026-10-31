/**
 * La memoria condivisa dell'archivio sportivo.
 *
 * Sta fuori da `lib/fanta` perche' tocca il database, e `lib/fanta` non deve.
 * Sta in un file suo perche' due percorsi diversi — il recupero delle
 * statistiche e la spazzata delle rose — spendono la **stessa** quota
 * giornaliera: se ognuno tenesse il proprio contatore, insieme ne spenderebbero
 * il doppio del consentito e se ne accorgerebbero solo col 429.
 */
import type { createClient } from "@/lib/supabase/server";
import { EMPTY_SEASON_MEMORY, type SeasonMemory } from "@/lib/fanta/recovery";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const API_STATE_KEY = "apifootball";

/** Tetto giornaliero del piano gratuito, azzerato a mezzanotte UTC. */
export const MAX_CALLS_PER_DAY = 100;

/**
 * Il piano gratuito accetta una decina di chiamate al minuto: oltre risponde
 * 429 e il lavoro in corso si interrompe. Meglio fermarsi prima.
 */
export const MAX_CALLS_PER_RUN = 9;

/** Come l'archivio dice che per oggi ha chiuso. */
export const QUOTA_GIORNALIERA_FINITA = /request limit for the day|reached the .*limit/i;

export type ApiMemory = SeasonMemory & {
  lastRunAt: string | null;
  day: string | null;
  callsToday: number;
};

export const EMPTY_API_MEMORY: ApiMemory = {
  ...EMPTY_SEASON_MEMORY,
  lastRunAt: null,
  day: null,
  callsToday: 0,
};

export const oggi = () => new Date().toISOString().slice(0, 10);

export async function readApiMemory(supabase: Supabase): Promise<ApiMemory> {
  const { data } = await supabase
    .from("app_state")
    .select("value")
    .eq("key", API_STATE_KEY)
    .maybeSingle();
  const stored = { ...EMPTY_API_MEMORY, ...((data?.value ?? {}) as Partial<ApiMemory>) };
  // Il tetto e' giornaliero e si azzera a mezzanotte UTC: un contatore di ieri
  // terrebbe chiuso l'archivio per sempre.
  return stored.day === oggi() ? stored : { ...stored, day: oggi(), callsToday: 0 };
}

export async function writeApiMemory(supabase: Supabase, memory: ApiMemory) {
  await supabase
    .from("app_state")
    .upsert(
      { key: API_STATE_KEY, value: memory, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

/**
 * Quante chiamate si possono spendere adesso.
 *
 * Due limiti diversi: il tetto del giorno, e i dieci al minuto — che sono
 * quelli che mordono. Se l'ultima corsa e' appena passata il budget e' zero, e
 * chi chiama fa altro invece di stare fermo ad aspettare il minuto.
 */
export function budgetOra(memory: ApiMemory): number {
  const daUltimo = memory.lastRunAt ? Date.now() - Date.parse(memory.lastRunAt) : Infinity;
  if (daUltimo < 60_000) return 0;
  return Math.min(MAX_CALLS_PER_RUN, Math.max(0, MAX_CALLS_PER_DAY - memory.callsToday));
}

/** Registra quanto e' stato speso, e se l'archivio ha chiuso per oggi. */
export function dopoLaCorsa(memory: ApiMemory, calls: number, stopped: string | null): ApiMemory {
  return {
    ...memory,
    lastRunAt: new Date().toISOString(),
    day: oggi(),
    callsToday:
      stopped && QUOTA_GIORNALIERA_FINITA.test(stopped)
        ? MAX_CALLS_PER_DAY
        : memory.callsToday + calls,
  };
}
