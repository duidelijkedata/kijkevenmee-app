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

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "KEM-";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

type InviteRow = {
  id: string;
  code: string;
  status: string;
  expires_at: string;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
};

export default function KoppelenClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [invites, setInvites] = useState<(InviteRow & { accepted_by_name?: string | null })[]>([]);

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://kijkevenmee-app.vercel.app";

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

  const refreshInvites = async () => {
    const { data, error } = await supabase
      .from("helper_invites")
      .select("id, code, status, expires_at, created_at, accepted_by, accepted_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error || !data) return;

    const rows = data as InviteRow[];

    const acceptedIds = rows.map((r) => r.accepted_by).filter(Boolean) as string[];
    const nameMap = await lookupNames(acceptedIds);

    setInvites(
      rows.map((r) => ({
        ...r,
        accepted_by_name: r.accepted_by ? nameMap[r.accepted_by] ?? null : null,
      }))
    );
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;

      if (!uid) {
        router.replace(`/kind/login?next=${encodeURIComponent("/ouder/koppelen")}`);
        return;
      }

      setUserId(uid);
      refreshInvites();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createInvite = async () => {
    setBusy(true);
    setStatusMsg(null);

    try {
      if (!userId) {
        setStatusMsg("Niet ingelogd.");
        return;
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();

        const { error } = await supabase.from("helper_invites").insert({
          code,
          helper_id: userId,
        });

        if (!error) {
          setStatusMsg("Nieuwe koppelcode aangemaakt.");
          await refreshInvites();
          return;
        }

        const msg = (error as any)?.message ?? "";
        if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) continue;

        setStatusMsg(`Fout: ${msg}`);
        return;
      }

      setStatusMsg("Kon geen unieke code maken. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setStatusMsg("Code gekopieerd naar klembord.");
    } catch {
      setStatusMsg("Kopiëren mislukt. Kopieer handmatig de code.");
    }
  };

  const copyLink = async (code: string) => {
    const link = `${origin}/join/${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setStatusMsg("Link gekopieerd naar klembord.");
    } catch {
      setStatusMsg("Kopiëren mislukt. Kopieer handmatig de link hieronder.");
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Koppelen met kind</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Maak een koppelcode aan en stuur die code naar je kind. Je kind kan inloggen en in{" "}
        <b>Mijn omgeving</b> de code plakken bij <b>Koppelcode ouder(s)</b>.
      </p>

      <button
        onClick={createInvite}
        disabled={busy}
        style={{
          marginTop: 10,
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid #0f172a",
          background: busy ? "#e2e8f0" : "#0f172a",
          color: busy ? "#0f172a" : "#ffffff",
          cursor: busy ? "not-allowed" : "pointer",
          fontWeight: 600,
        }}
      >
        {busy ? "Bezig…" : "Nieuwe koppelcode maken"}
      </button>

      {statusMsg ? <p style={{ marginTop: 12, color: "#475569" }}>{statusMsg}</p> : null}

      <h2 style={{ fontSize: 16, marginTop: 22 }}>Recente codes</h2>

      {invites.length === 0 ? (
        <p style={{ color: "#64748b" }}>Nog geen codes.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {invites.map((inv) => {
            const link = `${origin}/join/${encodeURIComponent(inv.code)}`;
            const acceptedLabel =
              inv.accepted_by_name ||
              (inv.accepted_by ? inv.accepted_by.slice(0, 8) + "…" : null);

            return (
              <div
                key={inv.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{inv.code}</div>
                    <div style={{ color: "#64748b", fontSize: 13 }}>
                      Status: <b>{inv.status}</b> • Verloopt:{" "}
                      {inv.expires_at ? new Date(inv.expires_at).toLocaleString("nl-NL") : ""}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 13, marginTop: 4, wordBreak: "break-all" }}>{link}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button
                      onClick={() => copyCode(inv.code)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "#fff",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Kopieer code
                    </button>

                    <button
                      onClick={() => copyLink(inv.code)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        background: "#f8fafc",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Kopieer link
                    </button>
                  </div>
                </div>

                {inv.accepted_by ? (
                  <div style={{ marginTop: 10, color: "#16a34a", fontSize: 13 }}>
                    ✅ Geaccepteerd door <b>{acceptedLabel}</b> op{" "}
                    {inv.accepted_at ? new Date(inv.accepted_at).toLocaleString("nl-NL") : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
