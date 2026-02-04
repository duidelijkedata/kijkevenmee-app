"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Textarea } from "@/components/ui";
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

type RelationshipRow = {
  helper_id: string | null;
  child_id: string | null;
};

export default function OuderStart() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<{ code: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [linkedChildren, setLinkedChildren] = useState<LinkedChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  // ✅ debug: login status
  const [parentUserId, setParentUserId] = useState<string | null>(null);
  const [relatedUsersStatus, setRelatedUsersStatus] = useState<"idle" | "ok" | "unauth" | "error">("idle");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;
      setParentUserId(uid);
      if (!uid) return;

      const { data: rels, error: relErr } = await supabase
        .from("helper_relationships")
        .select("child_id, helper_id")
        .or(`helper_id.eq.${uid},child_id.eq.${uid}`);

      if (relErr) return;

      const relatedIds = new Set<string>();
      for (const r of (rels ?? []) as RelationshipRow[]) {
        const helperId = r.helper_id ?? null;
        const childId = r.child_id ?? null;
        if (helperId === uid && childId) relatedIds.add(childId);
        if (childId === uid && helperId) relatedIds.add(helperId);
      }

      const ids = Array.from(relatedIds).filter(Boolean);
      if (!ids.length) {
        setLinkedChildren([]);
        setSelectedChildId(null);
        return;
      }

      const resp = await fetch("/api/related-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      if (resp.status === 401) {
        setRelatedUsersStatus("unauth");
        return;
      }

      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setRelatedUsersStatus("error");
        return;
      }

      setRelatedUsersStatus("ok");

      const users: RelatedUser[] = Array.isArray(j?.users) ? (j.users as RelatedUser[]) : [];
      const byId = new Map<string, RelatedUser>(users.map((u) => [u.id, u]));

      const mapped: LinkedChild[] = ids
        .map((id) => {
          const u = byId.get(id);
          if (!u) return null;

          const label = String(u.display_name ?? "").trim() || `Kind ${String(id).slice(0, 8)}…`;

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

    const shouldAssignToChild = Boolean(selectedChild && selectedChild.use_koppelcode === false);

    // ✅ debug in console: zie je dit in DevTools?
    console.log("[ouder/start]", {
      parentUserId,
      selectedChildId,
      selectedChild,
      shouldAssignToChild,
    });

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

    const code = String(json?.session?.code || "").trim();
    if (!code) return alert("Sessie is gemaakt maar code ontbreekt.");

    if (shouldAssignToChild) {
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

  const debugLine =
    parentUserId
      ? `Ingelogd (uid: ${parentUserId.slice(0, 8)}…), linkedChildren: ${linkedChildren.length}, related-users: ${relatedUsersStatus}`
      : `NIET ingelogd → "zonder code" kan niet werken, dus altijd code`;

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Vraag hulp aan je kind</h1>
        <p className="text-slate-600">
          Je kind kan veilig meekijken met je scherm om je te helpen. Je kind kan niets aanklikken of overnemen.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">Koppel een kind</h2>
          <p className="mt-1 text-slate-600">Maak een koppelcode en verbind accounts.</p>
          <div className="mt-4">
            <Link href="/ouder/koppelen">
              <Button className="w-full">Naar koppelen</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Gekoppelde kinderen</h2>
          <p className="mt-1 text-slate-600">Bekijk met welke kinderen je gekoppeld bent.</p>
          <div className="mt-4">
            <Link href="/ouder/gekoppeld">
              <Button className="w-full">Bekijk koppelingen</Button>
            </Link>
          </div>
        </Card>
      </div>

      {!created ? (
        <Card>
          <div className="space-y-3">
            {/* mini debug */}
            <p className="text-xs text-slate-500">{debugLine}</p>

            {linkedChildren.length ? (
              <div>
                <label className="block text-sm font-medium text-slate-700">Kies je kind</label>
                <div className="mt-1">
                  <select
                    className="h-12 w-full rounded-xl border px-3 bg-white"
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
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedChild?.use_koppelcode
                    ? "Deze hulpsessie start met een 6-cijferige code."
                    : "Deze hulpsessie start zonder code: je kind ziet de sessie direct bij Verbinden."}
                </p>
              </div>
            ) : null}

            <div>
              <label className="block text-sm font-medium text-slate-700">Naam (optioneel)</label>
              <div className="mt-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Jan" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Korte vraag (optioneel)</label>
              <div className="mt-1">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Bijv. Ik moet inloggen met DigiD"
                />
              </div>
            </div>

            <Button variant="primary" className="w-full" onClick={start} disabled={loading}>
              {loading ? "Bezig..." : "Start hulp"}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="text-xl font-semibold">Geef deze code aan je kind</h2>
            <p className="mt-1 text-slate-600">
              Kind gaat naar <span className="font-mono">/kind/verbinden</span> en vult de code in.
            </p>

            <div className="mt-4 rounded-2xl bg-slate-50 border p-4 text-center">
              <div className="text-4xl font-mono tracking-widest">
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
                className="w-full"
              >
                Kopieer info
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold">Scherm delen</h2>
            <p className="mt-1 text-slate-600">Klik hieronder om je scherm te delen. Je kind kan alleen kijken.</p>
            <div className="mt-4">
              <Link href={`/ouder/share/${created.code}`} className="block">
                <Button variant="primary" className="w-full">
                  Ga naar scherm delen
                </Button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
