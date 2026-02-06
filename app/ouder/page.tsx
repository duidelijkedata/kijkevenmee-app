"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type LinkedChild = {
  id: string;
  label: string;
  use_koppelcode: boolean;
};

type RelatedUser = {
  id: string;
  display_name?: string | null;
  use_koppelcode?: boolean | null;
};

export default function OuderStart() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [name, setName] = useState(""); // (optioneel, blijft voor compatibiliteit)
  const [note, setNote] = useState(""); // (optioneel, blijft voor compatibiliteit)
  const [created, setCreated] = useState<{ code: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [linkedChildren, setLinkedChildren] = useState<LinkedChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;
      if (!uid) return;

      const { data: rels } = await supabase
        .from("helper_relationships")
        .select("child_id, helper_id")
        .or(`helper_id.eq.${uid},child_id.eq.${uid}`);

      const ids = new Set<string>();
      for (const r of rels ?? []) {
        const childId = (r as any).child_id as string | null;
        const helperId = (r as any).helper_id as string | null;

        if (helperId === uid && childId) ids.add(childId);
        if (childId === uid && helperId) ids.add(helperId);
      }

      const wanted = Array.from(ids);
      if (!wanted.length) return;

      const r = await fetch("/api/related-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: wanted }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) return;

      const users: RelatedUser[] = Array.isArray(j?.users) ? (j.users as RelatedUser[]) : [];
      const byId = new Map<string, RelatedUser>(users.map((u) => [u.id, u]));

      const mapped: LinkedChild[] = wanted
        .map((id) => {
          const u = byId.get(id);
          if (!u) return null;

          const label = String(u.display_name ?? "").trim() || `Contact ${String(id).slice(0, 8)}…`;
          return {
            id,
            label,
            use_koppelcode: Boolean(u.use_koppelcode ?? true),
          } satisfies LinkedChild;
        })
        .filter(Boolean) as LinkedChild[];

      setLinkedChildren(mapped);
      if (mapped.length) setSelectedChildId(mapped[0].id);
    })();
  }, [supabase]);

  const selectedChild =
    selectedChildId ? linkedChildren.find((c) => c.id === selectedChildId) ?? null : null;

  async function start() {
    setLoading(true);
    setCreated(null);

    const shouldAssignToChild = Boolean(selectedChild && !selectedChild.use_koppelcode);

    const res = await fetch("/api/sessions/create-parent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requester_name: name || null,
        requester_note: note || null,
        helper_id: shouldAssignToChild ? selectedChild!.id : null,
      }),
    });

    const json = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok || json?.error) return alert(json?.error ?? "Onbekende fout");

    const session = json?.session as { code?: string; helper_id?: string | null } | undefined;
    const code = String(session?.code || "").trim();
    if (!code) return alert("Sessie is gemaakt maar code ontbreekt.");

    const autoAssigned = Boolean(json?.auto_assigned);
    const helperId = session?.helper_id ?? null;

    // ✅ Als de sessie zonder code kan starten: direct door naar schermdelen.
    if ((shouldAssignToChild || autoAssigned) && helperId) {
      router.push(`/ouder/share/${code}`);
      return;
    }

    setCreated({ code });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = created ? `${origin}/ouder/share/${created.code}` : "";
  const kidUrl = created ? `${origin}/kind/verbinden` : "";
  const waText = created
    ? encodeURIComponent(
        `Meekijken code: ${created.code.slice(0, 3)} ${created.code.slice(3)}\n\nKind opent: ${kidUrl}\n\nOuder scherm delen: ${shareUrl}`
      )
    : "";

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="mx-auto w-full max-w-6xl px-6 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-semibold">
              K
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-slate-900">Kijk even mee</div>
              <div className="text-[11px] tracking-wide text-slate-500">OUDER DASHBOARD</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/ouder/koppelen">
              <Button className="h-10 rounded-full px-4 bg-white text-slate-900 border hover:bg-slate-50">
                Contact koppelen
              </Button>
            </Link>
            <Link href="/ouder/gekoppeld">
              <Button className="h-10 rounded-full px-4 bg-white text-slate-900 border hover:bg-slate-50">
                Contacten
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto w-full max-w-6xl px-6 pb-10 pt-10">
        {!created ? (
          <div className="grid items-start gap-10 lg:grid-cols-2">
            {/* Left intro */}
            <section className="pt-4">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-900">
                Met wie wil je een sessie starten?
              </h1>
              <p className="mt-4 max-w-xl text-slate-600">
                Je contactpersoon kan veilig meekijken met je scherm om je te helpen. Je contactpersoon kan niets
                aanklikken zonder jouw toestemming.
              </p>

              <ol className="mt-8 space-y-6">
                <li className="flex gap-4">
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-white border flex items-center justify-center font-semibold text-slate-700">
                    1
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Selecteer je contactpersoon</div>
                    <div className="text-sm text-slate-600">Kies uit de lijst met wie je de verbinding wilt maken.</div>
                  </div>
                </li>
                <li className="flex gap-4">
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-white border flex items-center justify-center font-semibold text-slate-700">
                    2
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Klik op ‘Star sessie’</div>
                    <div className="text-sm text-slate-600">
                      De sessie wordt direct klaargezet voor jouw contactpersoon.
                    </div>
                  </div>
                </li>
                <li className="flex gap-4">
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-white border flex items-center justify-center font-semibold text-slate-700">
                    3
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Deel je scherm</div>
                    <div className="text-sm text-slate-600">
                      Bevestig dat je je scherm wilt delen zodat je contactpersoon kan meekijken.
                    </div>
                  </div>
                </li>
              </ol>
            </section>

            {/* Right card */}
            <section className="lg:pt-10">
              <Card className="rounded-3xl border bg-white p-6 shadow-sm">
                <div className="text-[11px] font-semibold tracking-wide text-slate-400">MEEST RECENTE CONTACT</div>

                <div className="mt-4">
                  {linkedChildren.length ? (
                    <>
                      <div className="relative">
                        <select
                          className="h-14 w-full appearance-none rounded-2xl border bg-white px-4 pr-10 text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200"
                          value={selectedChildId ?? ""}
                          onChange={(e) => setSelectedChildId(e.target.value)}
                        >
                          {linkedChildren.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                              {c.use_koppelcode ? " (met code)" : " (zonder code)"}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                          ▾
                        </div>
                      </div>

                      <div className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                        <span className="mt-0.5 inline-block h-2.5 w-2.5 rounded-full bg-indigo-600" />
                        <span>
                          {selectedChild?.use_koppelcode
                            ? "Je contactpersoon ziet de sessie na het invullen van de code bij Verbinden."
                            : "Je contactpersoon ziet de sessie direct bij Verbinden."}
                        </span>
                      </div>

                      <Button
                        className="mt-6 h-12 w-full rounded-2xl backgroundColor:'#4f46e5' text-color:'#ffffff'"
                          onClick={start}
                           disabled={loading}
                            >
                           {loading ? "Bezig..." : "Start sessie"}
                        </Button>


                      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100">
                          🔒
                        </span>
                        <span className="font-medium">Veilige verbinding</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-3 text-slate-700 font-semibold">Nog geen contacten gekoppeld</div>
                      <p className="mt-1 text-sm text-slate-600">
                        Koppel eerst een contactpersoon om een sessie te kunnen starten.
                      </p>
                      <div className="mt-5">
                        <Link href="/ouder/koppelen">
                          <Button variant="primary" className="h-12 w-full rounded-2xl">
                            Contact koppelen
                          </Button>
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </Card>
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            <Card className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Geef deze code aan je kind</h2>
              <p className="mt-1 text-slate-600">
                Kind gaat naar <span className="font-mono">/kind/verbinden</span> en vult de code in.
              </p>

              <div className="mt-4 rounded-2xl bg-slate-50 border p-4 text-center">
                <div className="text-4xl font-mono tracking-widest text-slate-900">
                  {created.code.slice(0, 3)} {created.code.slice(3)}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <a
                  className="h-12 rounded-xl border bg-white hover:bg-slate-50 flex items-center justify-center font-medium"
                  href={`https://wa.me/?text=${waText}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Stuur via WhatsApp
                </a>
                <Button
                  onClick={() =>
                    navigator.clipboard.writeText(`Code: ${created.code}\nKind: ${kidUrl}\nOuder: ${shareUrl}`)
                  }
                  className="h-12 w-full rounded-xl"
                >
                  Kopieer info
                </Button>
              </div>
            </Card>

            <Card className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Scherm delen</h2>
              <p className="mt-1 text-slate-600">Klik hieronder om je scherm te delen. Je kind kan alleen kijken.</p>
              <div className="mt-4">
                <Link href={`/ouder/share/${created.code}`} className="block">
                  <Button variant="primary" className="h-12 w-full rounded-2xl">
                    Ga naar scherm delen
                  </Button>
                </Link>
              </div>
            </Card>

            <div className="flex justify-center">
              <Button
                className="h-10 rounded-full bg-white border text-slate-900 hover:bg-slate-50"
                onClick={() => setCreated(null)}
              >
                Terug
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
