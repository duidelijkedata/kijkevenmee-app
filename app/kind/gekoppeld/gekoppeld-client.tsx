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
  use_koppelcode?: boolean | null;
};

export default function GekoppeldClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<Profile[]>([]);
  const [startingFor, setStartingFor] = useState<string | null>(null);
  const [, setLastCreated] = useState<{ helperId: string; code: string } | null>(null);

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

      const helperIds = (rels ?? []).map((r: any) => r.helper_id).filter(Boolean);

      if (helperIds.length === 0) {
        setHelpers([]);
        setLoading(false);
        return;
      }

      // 2) profielen ophalen (vereist profiles_select_related policy)
      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("id, display_name, use_koppelcode")
        .in("id", helperIds);

      if (profErr) {
        setError(profErr.message);
        setLoading(false);
        return;
      }

      const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const ordered = helperIds.map((id: string) => byId.get(id)).filter(Boolean) as Profile[];

      setHelpers(ordered);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startNoCode(helperId: string) {
    setStartingFor(helperId);
    setLastCreated(null);
    try {
      const r = await fetch("/api/sessions/create-linked", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ helper_id: helperId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = j?.error === "not_linked" ? "Niet gekoppeld (meer) met deze helper." : (j?.error ?? "Onbekende fout");
        alert(msg);
        return;
      }
      const code = String(j?.session?.code || "");
      if (!code) {
        alert("Sessie gemaakt, maar geen code ontvangen.");
        return;
      }
      setLastCreated({ helperId, code });
      router.push(`/ouder/share/${code}`);
    } finally {
      setStartingFor(null);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Gekoppelde helpers</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Hier zie je met welke helper/ouders jouw account gekoppeld is.
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

                {/* Als de helper 'Meekijken starten met code' UIT heeft, kunnen we dit extra-makkelijk maken */}
                {h.use_koppelcode === false ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={() => startNoCode(h.id)}
                      disabled={startingFor === h.id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #0f172a",
                        background: startingFor === h.id ? "#e2e8f0" : "#0f172a",
                        color: startingFor === h.id ? "#0f172a" : "#ffffff",
                        cursor: startingFor === h.id ? "not-allowed" : "pointer",
                        fontWeight: 800,
                      }}
                    >
                      {startingFor === h.id ? "Bezig…" : "Start hulp (zonder code)"}
                    </button>
                    <div style={{ color: "#64748b", fontSize: 13, alignSelf: "center" }}>
                      Helper ziet dit automatisch bij <b>Verbinden</b>.
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 10, color: "#64748b", fontSize: 13 }}>
                    Deze helper gebruikt de 6-cijferige meekijkcode.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
