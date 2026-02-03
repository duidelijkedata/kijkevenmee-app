"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import PresencePing from "@/components/presence-ping";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createBrowserClient(url, anon);
}

type RelatedUser = {
  id: string;
  display_name: string | null;
  last_seen_at: string | null;
  use_koppelcode: boolean | null;
};

function isOnline(lastSeen: string | null) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 2 * 60 * 1000;
}

export default function GekoppeldClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<RelatedUser[]>([]);

  async function fetchRelated(ids: string[]) {
    const r = await fetch("/api/related-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error ?? "Failed to fetch related users");
    return (j?.users ?? []) as RelatedUser[];
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

      try {
        const related = await fetchRelated(helperIds);
        // behoud dezelfde volgorde als relaties
        const byId = new Map(related.map((u) => [u.id, u]));
        setHelpers(helperIds.map((id) => byId.get(id)).filter(Boolean) as RelatedUser[]);
      } catch (e: any) {
        setError(e?.message ?? "Onbekende fout");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <PresencePing />

      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Gekoppelde ouders/helpers</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Start een sessie door naar <b>Verbinden</b> te gaan. Je ziet ook of iemand recent actief was.
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
            const online = isOnline(h.last_seen_at);

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
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{label}</div>
                    <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                      {online ? "🟢 Online" : "⚪ Offline"}
                      {h.last_seen_at ? ` • laatst actief: ${new Date(h.last_seen_at).toLocaleString("nl-NL")}` : ""}
                    </div>

                    {h.use_koppelcode === false ? (
                      <div style={{ color: "#16a34a", fontSize: 13, marginTop: 6 }}>
                        ✅ Deze ouder kan sessies starten zonder dat jij een code hoeft over te typen.
                      </div>
                    ) : (
                      <div style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
                        Deze ouder gebruikt de 6-cijferige meekijkcode.
                      </div>
                    )}
                  </div>

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
                      height: 44,
                      alignSelf: "flex-start",
                    }}
                  >
                    Start meekijken
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
