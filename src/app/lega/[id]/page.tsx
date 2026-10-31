import { redirect } from "next/navigation";
import { loadLeague } from "@/lib/leagueData";

export default async function LeagueIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league } = await loadLeague(id);
  redirect(league.status === "setup" ? `/lega/${id}/impostazioni` : `/lega/${id}/asta`);
}
