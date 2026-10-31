import RostersView from "@/components/auction/RostersView";
import { loadLeague } from "@/lib/leagueData";
import { conConsigli } from "@/lib/livelli";

export const dynamic = "force-dynamic";

export default async function RostersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { livello } = await loadLeague(id);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold tracking-tight">Rose</h1>
      <p className="mb-5 text-sm text-[var(--text-faint)]">
        {conConsigli(livello)
          ? "Chi ha comprato cosa, quanto ha pagato rispetto al valore e quanto rende la sua formazione titolare."
          : "Chi ha comprato cosa, a quanto, e quanti crediti gli restano."}
      </p>
      <RostersView />
    </main>
  );
}
