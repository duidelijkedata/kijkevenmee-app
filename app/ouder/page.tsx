"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
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
        const childId = (r as any).child_id;
        const helperId = (r as any).helper_id;
        if (helperId === uid && childId) ids.add(childId);
        if (childId === uid && helperId) ids.add(helperId);
      }

      if (!ids.size) return;

      const res = await fetch("/api/related-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(ids) }),
      });

      const json = await res.json();
      const users: RelatedUser[] = json?.users ?? [];

      const mapped = users.map((u) => ({
        id: u.id,
        label: u.display_name || "Contact",
        use_koppelcode: Boolean(u.use_koppelcode ?? true),
      }));

      setLinkedChildren(mapped);
      if (mapped.length) setSelectedChildId(mapped[0].id);
    })();
  }, [supabase]);

  async function start() {
    setLoading(true);
    setCreated(null);

    const res = await fetch("/api/sessions/create-parent", { method: "POST" });
    const json = await res.json();
    setLoading(false);

    if (!res.ok) return alert("Fout bij starten sessie");
    setCreated({ code: json.session.code });
  }

  return (
    <div className="min-h-screen bg-[#F4F7FA]">
      {/* Topbar */}
      <div className="max-w-7xl mx-auto px-8 py-6 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#5A4EE5] flex items-center justify-center shadow-lg shadow-[#5A4EE5]/20">
            {/* users icon */}
            <svg width="22" height="22" fill="none" stroke="white" strokeWidth="2">
              <circle cx="7" cy="7" r="4" />
              <circle cx="15" cy="7" r="4" />
              <path d="M2 20c0-3 4-5 5-5s5 2 5 5" />
              <path d="M12 20c0-3 4-5 5-5s5 2 5 5" />
            </svg>
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">Kijk even mee</div>
            <div className="text-[10px] tracking-widest font-bold text-slate-400">
              OUDER DASHBOARD
            </div>
          </div>
        </div>

        <div className="hidden md:flex gap-3">
          <Link
            href="/ouder/koppelen"
            className="px-4 py-2 rounded-full bg-white border text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
          >
            Contact koppelen
          </Link>
          <Link
            href="/ouder/gekoppeld"
            className="px-4 py-2 rounded-full bg-white border text-sm font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
          >
            Contacten
          </Link>
        </div>
      </div>

      {/* Content */}
      {!created ? (
        <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-2 gap-16">
          {/* Left */}
          <div>
            <h1 className="text-5xl font-bold text-slate-900 leading-tight mb-6">
              Met wie wil je een
              <br />
              sessie starten?
            </h1>
            <p className="text-lg text-slate-500 max-w-lg">
              Je contactpersoon kan veilig meekijken met je scherm om je te helpen.
            </p>

            <ol className="mt-12 space-y-8">
              {[1, 2, 3].map((n) => (
                <li key={n} className="flex gap-6">
                  <div className="w-12 h-12 rounded-2xl bg-white border shadow-sm flex items-center justify-center font-bold text-[#5A4EE5]">
                    {n}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">
                      {n === 1 && "Selecteer je contactpersoon"}
                      {n === 2 && "Klik op Start hulp"}
                      {n === 3 && "Deel je scherm"}
                    </div>
                    <div className="text-slate-500">
                      {n === 1 && "Kies wie je wilt laten meekijken."}
                      {n === 2 && "De sessie wordt direct klaargezet."}
                      {n === 3 && "Je contactpersoon kan alleen kijken."}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Right card */}
          <div className="relative">
            <div className="bg-white rounded-[2.5rem] p-12 shadow-2xl shadow-indigo-100/50">
              <div className="text-[11px] tracking-widest font-bold text-slate-400 mb-4">
                MEEST RECENTE CONTACT
              </div>

              {linkedChildren.length ? (
                <>
                  <select
                    className="w-full bg-slate-50 rounded-2xl px-6 py-5 text-lg font-semibold text-slate-700 outline-none"
                    value={selectedChildId ?? ""}
                    onChange={(e) => setSelectedChildId(e.target.value)}
                  >
                    {linkedChildren.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={start}
                    disabled={loading}
                    className="mt-8 w-full bg-[#5A4EE5] hover:bg-[#4D42CC] text-white font-bold py-6 rounded-2xl text-xl shadow-xl shadow-[#5A4EE5]/25 transition"
                  >
                    {loading ? "Bezig..." : "Start hulp"}
                  </button>

                  <div className="mt-6 flex items-center gap-2 justify-center text-slate-400 text-xs font-bold">
                    🔒 Veilige verbinding
                  </div>
                </>
              ) : (
                <Link href="/ouder/koppelen">
                  <button className="w-full bg-[#5A4EE5] text-white font-bold py-6 rounded-2xl text-xl">
                    Contact koppelen
                  </button>
                </Link>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-xl mx-auto py-20 text-center">
          <div className="bg-white rounded-3xl p-10 shadow-xl">
            <div className="text-5xl font-mono tracking-widest text-slate-900">
              {created.code.slice(0, 3)} {created.code.slice(3)}
            </div>
            <Link href={`/ouder/share/${created.code}`}>
              <Button className="mt-8 w-full h-12 rounded-2xl bg-[#5A4EE5]">
                Ga naar scherm delen
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
