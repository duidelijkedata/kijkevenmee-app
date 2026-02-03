"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createBrowserClient(url, anon);
}

type ChildRow = {
  id: string;
  display_name: string | null;
};

export default function GekoppeldClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildRow[]>([]);

  async function lookupNames(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 50);
    if (unique.length === 0) return {} as Record<string, string | null>;

    // Let op: als je deze API route nog NIET hebt toegevoegd, zie stap 2 hieronder.
    const r = await fetch("/api/profiles/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unique }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) return {} as Record<string, string | null>;
    return (j?.profiles ?? {}) as Record<string, string | null>;
  }

  useEffect(() => {
    (async () => {
      setError(null);
      setLoading(true);

      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;

      if (!uid) {
        router.replace(`/ouder/login?next=${encodeURIComponent("/ouder/gekoppeld")}`);
        return;
      }

      // ✅ Voor ouder/helper: relaties ophalen waar jij helper_id bent
      const { data: rels, error: relErr } = await supabase
        .from("helper_relationships")
        .select("child_id")
        .eq("helper_id", uid);

      if (relErr) {
        setError(relErr.message);
        setLoading(false);
        return;
      }

      const childIds = (rels ?? []).map((r: any) => r.child_id).filter(Boolean) as string[];

      if (childIds.length === 0) {
        setChildren([]);
        setLoading(false);
        return;
      }

      // Namen ophalen (via server lookup zodat RLS geen roet in het eten gooit)
      const nameMap = await lookupNames(childIds);

      const result: ChildRow[] = childIds.map((id) => ({
        id,
        display_name: nameMap[id] ?? null,
      }));

      setChildren(result);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Gekoppelde kinderen</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Hier zie je welke kind-accounts gekoppeld zijn aan jouw ouder/helper account.
      </p>

      {loading ? <p style={{ color: "#475569", marginTop: 16 }}>Laden…</p> : null}
      {error ? <p style={{ color: "#b91c1c", marginTop: 16 }}>Fout: {error}</p> : null}

      {!loading && !error && children.length === 0 ? (
        <p style={{ color: "#64748b", marginTop: 16 }}>
          Nog geen gekoppelde kinderen. Maak een koppelcode aan via <b>/ouder/koppelen</b>.
        </p>
      ) : null}

      {!loading && !error && children.length > 0 ? (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {children.map((c) => {
            const label = c.display_name?.trim() || `Kind ${c.id.slice(0, 8)}…`;
            return (
              <div
                key={c.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 800 }}>{label}</div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{c.id}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
