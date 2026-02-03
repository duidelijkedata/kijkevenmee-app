"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing env vars");
  return createBrowserClient(url, anon);
}

type Helper = {
  id: string;
  display_name: string | null;
  last_seen_at: string | null;
};

export default function GekoppeldClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [loading, setLoading] = useState(true);

  async function lookup(ids: string[]) {
    const r = await fetch("/api/profiles/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await r.json();
    return j.profiles as Record<string, string | null>;
  }

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;

      const { data: rels } = await supabase
        .from("helper_relationships")
        .select("helper_id")
        .eq("child_id", uid);

      const helperIds = (rels ?? []).map((r: any) => r.helper_id);

      if (helperIds.length === 0) {
        setHelpers([]);
        setLoading(false);
        return;
      }

      const nameMap = await lookup(helperIds);

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, last_seen_at")
        .in("id", helperIds);

      const helpers = helperIds.map((id) => {
        const p = profiles?.find((x: any) => x.id === id);
        return {
          id,
          display_name: nameMap[id] ?? null,
          last_seen_at: p?.last_seen_at ?? null,
        };
      });

      setHelpers(helpers);
      setLoading(false);
    })();
  }, []);

  function isOnline(lastSeen: string | null) {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 2 * 60 * 1000;
  }

  if (loading) return <p>Laden…</p>;

  return (
    <div className="space-y-3">
      {helpers.map((h) => (
        <div key={h.id} className="border rounded-lg p-4 bg-white">
          <div className="flex justify-between items-center">
            <div>
              <div className="font-semibold">
                {h.display_name || `Gebruiker ${h.id.slice(0, 6)}`}
              </div>
              <div className="text-sm text-slate-500">
                {isOnline(h.last_seen_at) ? "🟢 Online" : "⚪ Offline"}
              </div>
            </div>

            <button
              onClick={() => router.push(`/kind/verbinden?helper=${h.id}`)}
              className="px-4 py-2 rounded-md bg-slate-900 text-white font-semibold"
            >
              Start meekijken
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
