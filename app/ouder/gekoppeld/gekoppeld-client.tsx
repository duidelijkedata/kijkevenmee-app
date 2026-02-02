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

type Profile = {
  id: string;
  display_name: string | null;
};

export default function GekoppeldClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<Profile[]>([]);

  useEffect(() => {
    (async () => {
      setError(null);
      setLoading(true);

      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;

      if (!uid) {
        router.replace(`/kind/login?next=${encodeURIComponent("/ouder/gekoppeld")}`);
        return;
      }

      // 1) relaties ophalen waar jij helper bent
      const { data: rels, error: relErr } = await supabase
        .from("helper_relationships")
        .select("child_id")
        .eq("helper_id", uid);

      if (relErr) {
        setError(relErr.message);
        setLoading(false);
        return;
      }

      const childIds = (rels ?? []).map((r: any) => r.child_id).filter(Boolean);

      if (childIds.length === 0) {
        setChildren([]);
        setLoading(false);
        return;
      }

      // 2) profielen ophalen (vereist profiles_select_related policy)
      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", childIds);

      if (profErr) {
        setError(profErr.message);
        setLoading(false);
        return;
      }

      // sorteer in dezelfde volgorde als rels (optioneel)
      const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const ordered = childIds.map((id: string) => byId.get(id)).filter(Boolean) as Profile[];

      setChildren(ordered);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Gekoppelde kinderen</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Hier zie je met welke accounts jouw helper/ouder-account gekoppeld is.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => router.push("/ouder/koppelen")}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Nieuwe koppelcode
        </button>
      </div>

      {loading ? <p style={{ color: "#475569", marginTop: 16 }}>Laden…</p> : null}
      {error ? <p style={{ color: "#b91c1c", marginTop: 16 }}>Fout: {error}</p> : null}

      {!loading && !error && children.length === 0 ? (
        <p style={{ color: "#64748b", marginTop: 16 }}>Nog geen gekoppelde kinderen.</p>
      ) : null}

      {!loading && !error && children.length > 0 ? (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {children.map((c) => {
            const label = c.display_name?.trim() || `Gebruiker ${c.id.slice(0, 8)}…`;
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
