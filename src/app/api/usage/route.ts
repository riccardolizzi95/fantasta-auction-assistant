import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiFootballConfig, ping } from "@/lib/fanta/apiFootball";
import { openrouterModel } from "@/lib/fanta/openrouter";

export const runtime = "nodejs";

/**
 * Quanto e' stato consumato delle due fonti a pagamento.
 *
 * Nessuna delle due chiamate costa quota: /status di API-Football e' gratuito e
 * OpenRouter espone il credito residuo su un endpoint a parte.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const [football, openrouter] = await Promise.all([footballUsage(), openrouterUsage()]);
  return NextResponse.json({ football, openrouter });
}

type FootballUsage = {
  configured: boolean;
  ok?: boolean;
  used?: number;
  limit?: number;
  remaining?: number;
  plan?: string;
  message?: string;
};

/**
 * Il piano gratuito, quando la quota giornaliera e' finita, smette di rispondere
 * al contatore e restituisce un errore. E' il momento in cui il contatore serve
 * di piu': un pannello che a quota zero mostra una frase d'errore al posto del
 * numero lascia l'utente senza sapere quando potra' riprendere. Una quota
 * esaurita e' un'informazione, non un guasto, e va mostrata come tale.
 */
const QUOTA_FINITA = /request limit for the day|reached the .*limit/i;

async function footballUsage(): Promise<FootballUsage> {
  const cfg = apiFootballConfig();
  if (!cfg) return { configured: false, message: "Chiave non configurata." };

  const res = await ping(cfg);
  if (res.error && QUOTA_FINITA.test(res.error)) {
    return {
      configured: true,
      ok: true,
      used: 100,
      limit: 100,
      remaining: 0,
      message: "Quota del giorno esaurita: si azzera a mezzanotte UTC.",
    };
  }
  if (res.error) return { configured: true, ok: false, message: res.error };

  const detail = res.data as
    | { requests?: { current?: number; limit_day?: number }; subscription?: { plan?: string } }
    | null;
  const used = Number(detail?.requests?.current ?? 0);
  const limit = Number(detail?.requests?.limit_day ?? 0);
  return {
    configured: true,
    ok: true,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    plan: detail?.subscription?.plan,
  };
}

type OpenRouterUsage = {
  configured: boolean;
  ok?: boolean;
  spent?: number;
  granted?: number;
  remaining?: number;
  model?: string;
  message?: string;
};

async function openrouterUsage(): Promise<OpenRouterUsage> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { configured: false, message: "Chiave non configurata." };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const json = await res.json();
    if (!res.ok) {
      return { configured: true, ok: false, message: json?.error?.message ?? `OpenRouter ${res.status}` };
    }
    const granted = Number(json?.data?.total_credits ?? 0);
    const spent = Number(json?.data?.total_usage ?? 0);
    return {
      configured: true,
      ok: true,
      granted,
      spent,
      remaining: granted - spent,
      model: openrouterModel(),
    };
  } catch (e) {
    return { configured: true, ok: false, message: (e as Error).message };
  }
}
