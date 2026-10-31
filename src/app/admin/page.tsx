import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import AdminPanel from "@/components/AdminPanel";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) redirect("/");

  const { data: users } = await supabase.rpc("admin_list_users");

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-xl font-bold tracking-tight">Amministrazione</h1>
        <p className="mb-6 text-sm text-[var(--text-faint)]">
          Account e listone. Chi crei qui può entrare nelle tue leghe con il codice invito, e da
          qui decidi cosa vede: base segue l&apos;asta e lo storico, premium vede anche i consigli
          del motore.
        </p>
        <AdminPanel users={users ?? []} myId={user.id} />
      </main>
    </>
  );
}
