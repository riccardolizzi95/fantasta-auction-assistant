import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { caricaListone, valutaListone } from "@/lib/fanta/datiLega";
import { conConsigli, livelloDa } from "@/lib/livelli";
import type { LeagueRow, ParticipantRow } from "@/lib/fanta/types";

export const runtime = "nodejs";
// Dipende da chi chiede e da quanti crediti hanno le squadre: niente cache.
export const dynamic = "force-dynamic";

/**
 * I prezzi del modello, calcolati dove devono stare.
 *
 * Prima il conto lo faceva il browser: `buildValuations` girava nel portatile
 * di chiunque aprisse la pagina. Funzionava, ma metteva il modello — la parte
 * che distingue questo software da un foglio di calcolo — in mano a chi lo
 * usa, e rendeva il livello dell'utenza una tenda invece che un muro:
 * nascondere i prezzi nell'interfaccia non serve se sono comunque nella memoria
 * della scheda.
 *
 * Qui il muro c'e': per chi non ha il premium `buildValuations` **non viene
 * chiamato**. Non e' un filtro in uscita — quei numeri non esistono, quindi non
 * c'e' niente da dimenticarsi di togliere.
 *
 * Viaggiano solo le valutazioni, non il listone. Il listone il browser continua
 * a prenderselo da Supabase, che pagina da sola e non ha il tetto di 4.5 MB
 * delle funzioni: sono 1.9 MB contro i 0.3 di qui, e non c'e' motivo di farli
 * passare due volte dallo stesso imbuto.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  // Le regole del database gia' impediscono di leggere una lega altrui, ma da
  // sole lo fanno in silenzio: la lega semplicemente non c'e'. Meglio dirlo.
  const [{ data: league }, { data: participants }, { data: profilo }] = await Promise.all([
    supabase.from("leagues").select("*").eq("id", id).single(),
    supabase.from("participants").select("*").eq("league_id", id).order("created_at"),
    supabase.from("profiles").select("is_admin, is_premium").eq("id", user.id).single(),
  ]);
  if (!league) return NextResponse.json({ error: "Lega non trovata" }, { status: 404 });

  const livello = livelloDa(profilo);
  if (!conConsigli(livello)) return NextResponse.json({ livello, valutazioni: null });

  const players = await caricaListone((league as LeagueRow).season);
  return NextResponse.json({
    livello,
    valutazioni: valutaListone(players, league as LeagueRow, (participants ?? []) as ParticipantRow[]),
  });
}
