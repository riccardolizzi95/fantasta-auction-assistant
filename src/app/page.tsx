import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { Empty, Panel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { createLeague, joinLeague } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("league_members")
    .select("role, leagues(id, name, season, budget, n_participants, status, invite_code)")
    .eq("user_id", user!.id);

  type LeagueLite = {
    id: string;
    name: string;
    season: string;
    budget: number;
    n_participants: number;
    status: string;
    invite_code: string;
  };
  const leagues = (memberships ?? [])
    .map((m) => ({ role: m.role, league: m.leagues as unknown as LeagueLite }))
    .filter((m) => m.league);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Le tue leghe</h1>
        <p className="mt-1 text-sm text-[var(--text-faint)]">
          Stagione 2026/27 — crea una lega, invita gli altri con il codice e porta il software
          all&apos;asta.
        </p>

        <div className="mt-6 space-y-3">
          {leagues.length === 0 ? (
            <Empty>Non sei ancora in nessuna lega. Creane una qui sotto o entra con un codice.</Empty>
          ) : (
            leagues.map(({ league, role }) => (
              <Link
                key={league.id}
                href={league.status === "setup" ? `/lega/${league.id}/impostazioni` : `/lega/${league.id}/asta`}
                className="panel flex items-center gap-4 px-4 py-3.5 transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{league.name}</span>
                    {role === "owner" && <span className="chip">admin</span>}
                    {league.status === "setup" && (
                      <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
                        da configurare
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--text-faint)]">
                    {league.season} · {league.n_participants} squadre · {league.budget} crediti
                  </div>
                </div>
                <span className="chip num">{league.invite_code}</span>
                <span className="text-[var(--text-faint)]">→</span>
              </Link>
            ))
          )}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Panel title="Crea una nuova lega" subtitle="Le regole precise le regoli dopo, nelle impostazioni.">
            <form action={createLeague} className="space-y-3">
              <div>
                <label htmlFor="name">Nome della lega</label>
                <input id="name" name="name" required placeholder="Lega degli amici" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="budget">Crediti a squadra</label>
                  <input id="budget" name="budget" type="number" min={50} max={5000} defaultValue={500} />
                </div>
                <div>
                  <label htmlFor="n_participants">Numero squadre</label>
                  <input
                    id="n_participants"
                    name="n_participants"
                    type="number"
                    min={2}
                    max={20}
                    defaultValue={8}
                  />
                </div>
              </div>
              <fieldset className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                <legend className="label-xs px-1">Regole che cambiano la strategia</legend>
                <label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[var(--text)]">
                  <input type="checkbox" name="defense_modifier" className="h-4 w-4 accent-[var(--accent)]" style={{ width: "auto" }} />
                  <span className="text-sm">Modificatore di difesa attivo</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[var(--text)]">
                  <input type="checkbox" name="goalkeeper_modifier" className="h-4 w-4 accent-[var(--accent)]" style={{ width: "auto" }} />
                  <span className="text-sm">Modificatore portiere</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[var(--text)]">
                  <input type="checkbox" name="assist_enabled" defaultChecked className="h-4 w-4 accent-[var(--accent)]" style={{ width: "auto" }} />
                  <span className="text-sm">Assist attivi</span>
                </label>
              </fieldset>
              <button className="btn btn-primary w-full" type="submit">
                Crea lega
              </button>
            </form>
          </Panel>

          <Panel title="Entra in una lega esistente" subtitle="Serve il codice a 8 caratteri di chi l'ha creata.">
            <form action={joinLeague} className="space-y-3">
              <div>
                <label htmlFor="code">Codice invito</label>
                <input id="code" name="code" required placeholder="A1B2C3D4" className="num uppercase" />
              </div>
              <button className="btn w-full" type="submit">
                Entra
              </button>
            </form>
            <p className="mt-4 text-xs leading-relaxed text-[var(--text-faint)]">
              Entrando diventi un partecipante della lega: vedi la stessa asta in tempo reale, ma la
              tua strategia, il tuo budget e i tuoi consigli restano privati.
            </p>
          </Panel>
        </div>
      </main>
    </>
  );
}
