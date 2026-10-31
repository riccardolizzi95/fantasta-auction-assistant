/**
 * Quanto la fantamedia di una stagione predice quella dopo, ruolo per ruolo.
 *
 * Se per un ruolo la correlazione e' bassa, fidarsi dei suoi numeri passati
 * significa comprare rumore: e' il coefficiente con cui il motore regredisce
 * verso la media (ROLE_FM_PERSISTENCE in src/lib/fanta/types.ts).
 *
 * Serve un account amministratore in TEST_EMAIL / TEST_PASSWORD e almeno due
 * stagioni concluse caricate. Rilancialo quando aggiungi un'annata: i valori
 * nel codice andrebbero aggiornati con quelli che stampa.
 */
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import {
  ROLES,
  ROLE_BASELINE_FM,
  ROLE_BASELINE_MV,
  ROLE_FM_PERSISTENCE,
  type Role,
} from "../src/lib/fanta/types";
(globalThis as unknown as { WebSocket: unknown }).WebSocket ??= WebSocket;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

function stats(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  return { m, sd };
}
function corr(xs: number[], ys: number[]) {
  const a = stats(xs), b = stats(ys);
  const cov = xs.reduce((acc, x, i) => acc + (x - a.m) * (ys[i] - b.m), 0) / xs.length;
  return cov / (a.sd * b.sd);
}

async function main() {
  await supabase.auth.signInWithPassword({ email: process.env.TEST_EMAIL!, password: process.env.TEST_PASSWORD! });
  const { data } = await supabase
    .from("players").select("id, role, player_stats(season, matches, avg_vote, avg_fantavote)")
    .eq("season", "2026-27").eq("is_active", true);

  const byRole: Record<Role, { prev: number; next: number; mvPrev: number; mvNext: number }[]> =
    { P: [], D: [], C: [], A: [] };

  for (const p of data ?? []) {
    const rows = (p.player_stats ?? []) as { season: string; matches: number; avg_vote: number | null; avg_fantavote: number | null }[];
    const a = rows.find((r) => r.season === "2024-25");
    const b = rows.find((r) => r.season === "2025-26");
    if (!a || !b) continue;
    if (a.matches < 20 || b.matches < 20) continue;
    if (a.avg_fantavote == null || b.avg_fantavote == null || a.avg_vote == null || b.avg_vote == null) continue;
    byRole[p.role as Role].push({
      prev: Number(a.avg_fantavote), next: Number(b.avg_fantavote),
      mvPrev: Number(a.avg_vote), mvNext: Number(b.avg_vote),
    });
  }

  console.log("\nQuanto un anno predice il successivo (giocatori con 20+ presenze in entrambe)");
  console.log("Valori attualmente nel codice: " + ROLES.map((r) => `${r} ${ROLE_FM_PERSISTENCE[r]}`).join("  ") + "\n");
  console.log("ruolo   n    corr FM   corr MV   disp.FM   disp.MV");
  for (const r of ROLES) {
    const v = byRole[r];
    if (v.length < 12) { console.log(`${r}   ${v.length} — campione troppo piccolo`); continue; }
    const cFM = corr(v.map((x) => x.prev), v.map((x) => x.next));
    const cMV = corr(v.map((x) => x.mvPrev), v.map((x) => x.mvNext));
    const sFM = stats(v.map((x) => x.next)).sd;
    const sMV = stats(v.map((x) => x.mvNext)).sd;
    console.log(
      `${r}   ${String(v.length).padStart(3)}    ${cFM.toFixed(3)}     ${cMV.toFixed(3)}     ${sFM.toFixed(3)}     ${sMV.toFixed(3)}`,
    );
  }

  // I livelli di riferimento per ruolo: centro della regressione e ripiego
  // quando una fonte estera non da' la media voto.
  console.log("\nMedie dei titolari (20+ presenze) — valori nel codice fra parentesi\n");
  console.log("ruolo   n    media voto        fantamedia");
  for (const r of ROLES) {
    const rows = (data ?? [])
      .filter((p) => p.role === r)
      .flatMap((p) => (p.player_stats ?? []) as { season: string; matches: number; avg_vote: number | null; avg_fantavote: number | null }[])
      .filter((x) => x.matches >= 20 && x.avg_vote != null && x.avg_fantavote != null);
    if (rows.length === 0) continue;
    const mv = rows.reduce((a, x) => a + Number(x.avg_vote), 0) / rows.length;
    const fm = rows.reduce((a, x) => a + Number(x.avg_fantavote), 0) / rows.length;
    console.log(
      `${r}   ${String(rows.length).padStart(3)}    ${mv.toFixed(3)} (${ROLE_BASELINE_MV[r]})   ` +
        `${fm.toFixed(3)} (${ROLE_BASELINE_FM[r]})`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
