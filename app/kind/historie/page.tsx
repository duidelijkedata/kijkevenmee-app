export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Button } from "@/components/ui";
import Link from "next/link";

export default async function Historie() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return (
      <main className="mx-auto max-w-lg space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Historie</h1>
        <Card>
          <p className="text-slate-700">Log eerst in.</p>
          <div className="mt-4">
            <Link href="/kind/login"><Button variant="primary" className="w-full">Inloggen</Button></Link>
          </div>
        </Card>
      </main>
    );
  }

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, code, status, created_at")
    .eq("helper_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Historie</h1>
        <p className="text-slate-600">Eerdere hulpsessies.</p>
      </header>

      <div className="grid gap-4">
        {(sessions?.length ? sessions : []).map((s) => (
          <Card key={s.id}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">Code: <span className="font-mono">{s.code}</span></div>
                <div className="text-sm text-slate-600">{new Date(s.created_at).toLocaleString("nl-NL")}</div>
              </div>
              <div className="text-sm text-slate-700">Status: <span className="font-mono">{s.status}</span></div>
            </div>
          </Card>
        ))}
        {!sessions?.length ? (
          <Card><p className="text-slate-700">Nog geen sessies.</p></Card>
        ) : null}
      </div>
    </main>
  );
}
