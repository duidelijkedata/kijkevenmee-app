"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anon);
}

type Invite = {
  id: string;
  code: string;
  helper_id: string;
  status: "open" | "accepted" | "expired";
  expires_at: string;
  created_at: string;
};

export default function JoinClient({ code }: { code: string }) {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // moet ingelogd zijn om te koppelen
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id ?? null;

      if (!uid) {
        router.replace(`/kind/login?next=${encodeURIComponent(`/join/${code}`)}`);
        return;
      }

      // invite ophalen
      const { data: inv, error } = await supabase
        .from("helper_invites")
        .select("id, code, helper_id, status, expires_at, created_at")
        .eq("code", code)
        .maybeSingle();

      if (error || !inv) {
        setMessage("Deze koppelcode bestaat niet (meer) of is niet toegankelijk.");
        setInvite(null);
        setLoading(false);
        return;
      }

      // status checks client-side (RLS doet ook al wat)
      if (inv.status !== "open") {
        setMessage("Deze koppelcode is al gebruikt of niet meer geldig.");
      } else if (new Date(inv.expires_at).getTime() < Date.now()) {
        setMessage("Deze koppelcode is verlopen.");
      }

      setInvite(inv as any);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const accept = async () => {
    setBusy(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("accept_helper_invite", { p_code: code });

      if (error) {
        setMessage(`Koppelen mislukt: ${error.message}`);
        return;
      }

      setMessage("✅ Gelukt! Je bent nu gekoppeld.");
      router.replace("/kind");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Koppelen</h1>
        <p style={{ color: "#475569", margin: 0 }}>Laden…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Koppelen</h1>

      <p style={{ color: "#475569", marginTop: 0 }}>
        Je staat op het punt om een koppeling te maken met een helper (ouder/kind).
      </p>

      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 12,
          background: "#fff",
          marginTop: 12,
        }}
      >
        <div style={{ fontWeight: 700 }}>Code: {code}</div>
        {invite ? (
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
            Geldig tot: {new Date(invite.expires_at).toLocaleString("nl-NL")}
          </div>
        ) : null}
      </div>

      {message ? <p style={{ marginTop: 12, color: message.startsWith("✅") ? "#16a34a" : "#b91c1c" }}>{message}</p> : null}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={() => router.replace("/kind")}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Annuleren
        </button>

        <button
          onClick={accept}
          disabled={busy || !invite || invite.status !== "open" || new Date(invite.expires_at).getTime() < Date.now()}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #0f172a",
            background: busy ? "#e2e8f0" : "#0f172a",
            color: busy ? "#0f172a" : "#ffffff",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
        >
          {busy ? "Bezig…" : "Accepteer koppeling"}
        </button>
      </div>
    </main>
  );
}
