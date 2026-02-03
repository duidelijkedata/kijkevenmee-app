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

type HelperRow = {
  id: string;
  display_name: string | null;
  use_koppelcode?: boolean | null;
};

export default function GekoppeldClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [helpers, setHelpers] = useState<HelperRow[]>([]);

  async function lookupNames(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 50);
    if (unique.length === 0) return {} as Record<string, string | null>;

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
        router.replace(`/kind/login?next=${encodeURIComponent("/kind/gekoppeld")}`);
        return;
      }

      // 1) relaties ophalen waar jij child bent
      const { data: rels, error: relErr } = await supabase
        .from("helper_relationships")
        .select("helper_id")
        .eq("child_id", uid);

      if (relErr) {
        setError(relErr.message);
        setLoading(false);
        return;
      }

      const helperIds = (rels ?? []).map((r: any) => r.helper_id).filter(Boolean) as string[];

      if (helperIds.length === 0) {
        setHelpers([]);
        setLoading(false);
        return;
      }

      // 2) use_koppelcode proberen op te halen (mag falen door RLS)
      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id, use_koppelcode")
        .in("id", helperIds);

      const useMap = new Map<string, boolean | null>();
      if (!profErr && profs) {
        for (const p of profs as any[]) useMap.set(p.id, p.use_koppelcode ?? null);
      }

      // 3) namen via server lookup (service role)
      const nameMap = await lookupNames(helperIds);

      const result: HelperRow[] = helperIds.map((id) => ({
        id,
        display_name: nameMap[id] ?? null,
        use_koppelcode: useMap.get(id) ?? null,
      }));

      setHelpers(result);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Gekoppelde ouders/helpers</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Hier zie je met welke ouder(s)/helper(s) jouw account gekoppeld is.
      </p>

      {loading ? <p style={{ color: "#475569", marginTop: 16 }}>Laden…</p> : null}
      {error ? <p style={{ color: "#b91c1c", marginTop: 16 }}>Fout: {error}</p> : null}

      {!loading && !error && helpers.length === 0 ? (
        <p style={{ color: "#64748b", marginTop: 16 }}>Nog geen gekoppelde helpers.</p>
      ) : null}

      {!loading && !error && helpers.length > 0 ? (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {helpers.map((h) => {
            const label = h.display_name?.trim() || `Gebruiker ${h.id.slice(0, 8)}…`;

            return (
              <div
                key={h.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 800 }}>{label}</div>
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{h.id}</div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => router.push("/kind/verbinden")}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #0f172a",
                      background: "#0f172a",
                      color: "#fff",
                      cursor: "pointer",
                      fontWeight: 800,
                    }}
                  >
                    Start meekijken
                  </button>

                  <div style={{ color: "#64748b", fontSize: 13, alignSelf: "center" }}>
                    Ga naar <b>Verbinden</b> om een 6-cijferige code in te vullen.
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
