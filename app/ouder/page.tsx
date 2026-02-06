"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Users, UserPlus, ChevronDown, ShieldCheck, Play, Lock, RefreshCw } from "lucide-react";

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

  // (compatibiliteit met je bestaande API; je gebruikt dit mogelijk later)
  const [name] = useState("");
  const [note] = useState("");

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
    <div className="min-h-screen font-sans bg-[#F4F7FA]">
      {/* Topbar (pixel perfect) */}
      <nav className="w-full max-w-7xl mx-auto px-8 py-6 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#5A4EE5] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#5A4EE5]/20">
            <Users className="h-7 w-7" />
          </div>
          <div>
            <span className="text-xl font-bold block leading-none text-slate-900">Kijk even mee</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              OUDER DASHBOARD
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* exact zoals png: hidden op klein scherm */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/ouder/koppelen"
              className="bg-white border border-slate-100 px-4 py-2 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
            >
              <UserPlus className="h-4 w-4 text-slate-500" />
              Contact koppelen
            </Link>

            <Link
              href="/ouder/gekoppeld"
              className="bg-white border border-slate-100 px-4 py-2 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
            >
              <Users className="h-4 w-4 text-slate-500" />
              Contacten
            </Link>
          </div>
        </div>
      </nav>

      {/* Main */}
      {!created ? (
        <main className="flex-grow flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-6xl">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Left */}
              <div className="space-y-12">
                <header>
                  <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6 leading-tight">
                    Met wie wil je een
                    <br />
                    sessie starten?
                  </h1>
                  <p className="text-lg text-slate-500 leading-relaxed max-w-lg">
                    Je contactpersoon kan veilig meekijken met je scherm om je te helpen. Je contactpersoon kan niets
                    aanklikken zonder jouw toestemming.
                  </p>
                </header>

                <div className="space-y-8">
                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 text-[#5A4EE5] flex items-center justify-center font-bold text-lg">
                      1
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900">Selecteer je contactpersoon</h3>
                      <p className="text-slate-500">
                        Kies uit de lijst met wie je de verbinding wilt maken.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 text-[#5A4EE5] flex items-center justify-center font-bold text-lg">
                      2
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900">Klik op &quot;Start hulp&quot;</h3>
                      <p className="text-slate-500">
                        De sessie wordt direct klaargezet voor jouw contactpersoon.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 text-[#5A4EE5] flex items-center justify-center font-bold text-lg">
                      3
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-bold text-slate-900">Deel je scherm</h3>
                      <p className="text-slate-500">
                        Bevestig dat je je scherm wilt delen zodat je contactpersoon kan meekijken.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right card (pixel perfect) */}
              <div className="relative">
                <div className="bg-white rounded-[2.5rem] p-10 md:p-14 shadow-2xl shadow-indigo-100/50 border border-white">
                  {linkedChildren.length ? (
                    <form
                      className="space-y-10"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void start();
                      }}
                    >
                      <div className="space-y-4">
                        <label
                          className="block text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1"
                          htmlFor="child-select"
                        >
                          MEEST RECENTE CONTACT
                        </label>

                        <div className="relative">
                          <select
                            id="child-select"
                            className="block w-full appearance-none bg-slate-50 border-none rounded-2xl px-6 py-5 text-lg font-semibold text-slate-700 focus:ring-2 focus:ring-[#5A4EE5]/20 outline-none transition-all cursor-pointer"
                            value={selectedChildId ?? ""}
                            onChange={(e) => setSelectedChildId(e.target.value)}
                          >
                            {linkedChildren.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label} {c.use_koppelcode ? "(met code)" : "(zonder code)"}
                              </option>
                            ))}
                          </select>

                          <div className="absolute inset-y-0 right-0 flex items-center pr-6 pointer-events-none text-slate-400">
                            <ChevronDown className="h-5 w-5" />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 px-1">
                          <ShieldCheck className="h-5 w-5 text-[#5A4EE5]" />
                          <p className="text-sm text-slate-400 font-medium">
                            {selectedChild?.use_koppelcode
                              ? "Je contactpersoon ziet de sessie bij Verbinden na het invullen van de code."
                              : "Je contactpersoon ziet de sessie direct bij Verbinden."}
                          </p>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className={[
                          "w-full bg-[#5A4EE5] hover:bg-[#4D42CC] text-white font-bold py-6 rounded-2xl text-xl",
                          "shadow-xl shadow-[#5A4EE5]/25 transition-all active:transform active:scale-[0.99]",
                          "flex items-center justify-center gap-3",
                          loading ? "opacity-70 cursor-not-allowed" : "",
                        ].join(" ")}
                      >
                        <Play className="h-6 w-6" />
                        {loading ? "Bezig..." : "Start hulp"}
                      </button>

                      <div className="flex items-center justify-center gap-3">
                        <div className="h-px bg-slate-100 flex-grow" />
                        <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-full">
                          <Lock className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Veilige Verbinding
                          </span>
                        </div>
                        <div className="h-px bg-slate-100 flex-grow" />
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-8">
                      <div className="space-y-2">
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1">
                          MEEST RECENTE CONTACT
                        </div>
                        <div className="text-xl font-bold text-slate-900">Nog geen contacten gekoppeld</div>
                        <p className="text-slate-500">
                          Koppel eerst een contactpersoon om een sessie te kunnen starten.
                        </p>
                      </div>

                      <Link href="/ouder/koppelen">
                        <button className="w-full bg-[#5A4EE5] hover:bg-[#4D42CC] text-white font-bold py-6 rounded-2xl text-xl shadow-xl shadow-[#5A4EE5]/25 transition-all active:transform active:scale-[0.99] flex items-center justify-center gap-3">
                          <UserPlus className="h-6 w-6" />
                          Contact koppelen
                        </button>
                      </Link>

                      <div className="flex items-center justify-center gap-3">
                        <div className="h-px bg-slate-100 flex-grow" />
                        <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-full">
                          <Lock className="h-3.5 w-3.5 text-slate-400" />
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Veilige Verbinding
                          </span>
                        </div>
                        <div className="h-px bg-slate-100 flex-grow" />
                      </div>
                    </div>
                  )}
                </div>

                {/* ronde knop onder de kaart (zoals png) */}
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-12 h-12 bg-[#F0EFFF] rounded-full flex items-center justify-center text-[#5A4EE5] shadow-sm border border-white">
                  <RefreshCw className="h-5 w-5" />
                </div>
              </div>
            </div>
          </div>
        </main>
      ) : (
        // Created state (buiten de png, maar netjes gehouden)
        <main className="px-6 py-12">
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="bg-white rounded-[2.5rem] p-10 md:p-14 shadow-2xl shadow-indigo-100/50 border border-white">
              <h2 className="text-2xl font-bold text-slate-900">Geef deze code aan je kind</h2>
              <p className="mt-2 text-slate-500">
                Kind gaat naar <span className="font-mono">/kind/verbinden</span> en vult de code in.
              </p>

              <div className="mt-6 rounded-2xl bg-slate-50 p-6 text-center">
                <div className="text-5xl font-mono tracking-widest text-slate-900">
                  {created.code.slice(0, 3)} {created.code.slice(3)}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <a
                  className="h-12 rounded-xl border bg-white hover:bg-slate-50 flex items-center justify-center font-semibold text-slate-600 shadow-sm"
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
                  className="h-12 w-full rounded-xl bg-[#5A4EE5] hover:bg-[#4D42CC] text-white font-bold shadow-xl shadow-[#5A4EE5]/25"
                >
                  Kopieer info
                </Button>
              </div>

              <div className="mt-10">
                <Link href={`/ouder/share/${created.code}`} className="block">
                  <button className="w-full bg-[#5A4EE5] hover:bg-[#4D42CC] text-white font-bold py-6 rounded-2xl text-xl shadow-xl shadow-[#5A4EE5]/25 transition-all active:transform active:scale-[0.99]">
                    Ga naar scherm delen
                  </button>
                </Link>
              </div>

              <div className="mt-6 flex justify-center">
                <button
                  className="bg-white border border-slate-100 px-4 py-2 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                  onClick={() => setCreated(null)}
                >
                  Terug
                </button>
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
