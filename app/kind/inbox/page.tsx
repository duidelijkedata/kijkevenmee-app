export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Button } from "@/components/ui";
import Link from "next/link";

export default async function Inbox() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return (
      <main className="mx-auto max-w-lg space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <Card>
          <p className="text-slate-700">Log eerst in.</p>
          <div className="mt-4">
            <Link href="/kind/login"><Button variant="primary" className="w-full">Inloggen</Button></Link>
          </div>
        </Card>
      </main>
    );
  }

  // Fetch snapshot metadata via server (RLS allows helper_id = auth.uid())
  const { data: snaps } = await supabase
    .from("snapshots")
    .select("id, caption, storage_path, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  // Signed URLs (1h)
  const items = [];
  for (const s of snaps || []) {
    const { data: signed } = await supabase.storage.from("snapshots").createSignedUrl(s.storage_path, 3600);
    items.push({ ...s, url: signed?.signedUrl ?? null });
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-slate-600">Nieuwe schermafbeeldingen en verzoeken.</p>
      </header>

      <div className="grid gap-4">
        {(items.length ? items : [{ id: "empty", caption: "Nog geen items.", url: null, created_at: null }]).map((it: any) => (
          <Card key={it.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold">{it.caption || "Schermafbeelding"}</div>
                <div className="text-sm text-slate-600">{it.created_at ? new Date(it.created_at).toLocaleString("nl-NL") : ""}</div>
              </div>
              {it.url ? (
                <a className="shrink-0 text-sm underline" href={it.url} target="_blank">Open</a>
              ) : null}
            </div>
            {it.url ? (
              <img src={it.url} alt={it.caption || "snapshot"} className="mt-4 w-full rounded-xl border" />
            ) : null}
          </Card>
        ))}
      </div>
    </main>
  );
}
