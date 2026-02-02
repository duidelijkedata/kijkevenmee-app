import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">Mijn omgeving</h1>
      <p className="mt-2 text-slate-600">
        Ingelogd als: {data.user?.email ?? "onbekend"}
      </p>

      <div className="mt-6 space-y-3">
        <a className="underline" href="/kind/verbinden">Verbinden</a><br/>
        <a className="underline" href="/kind/inbox">Inbox</a><br/>
        <a className="underline" href="/kind/historie">Historie</a><br/>
        <a className="underline" href="/kind/instellingen">Instellingen</a>
      </div>
    </main>
  );
}
