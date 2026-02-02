"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function KindLoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const sp = useSearchParams();

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const error = sp.get("error");
  const next = sp.get("next") ?? "/kind";

  const sendMagicLink = async () => {
    setBusy(true);
    setStatus(null);

    try {
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "https://kijkevenmee-app.vercel.app";

      // ✅ Dit is de essentie: ALTIJD naar /auth/callback met next=...
      const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo,
        },
      });

      if (error) {
        setStatus(`Fout: ${error.message}`);
        return;
      }

      setStatus("Check je e-mail en klik op de inloglink.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Inloggen</h1>

      {error ? (
        <p style={{ color: "#b91c1c", marginTop: 0 }}>
          Login fout: <code>{error}</code>
        </p>
      ) : null}

      <label style={{ display: "block", margin: "16px 0 6px 0", color: "#0f172a" }}>
        E-mailadres
      </label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="naam@domein.nl"
        type="email"
        autoComplete="email"
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          outline: "none",
        }}
      />

      <button
        onClick={sendMagicLink}
        disabled={busy || !email.includes("@")}
        style={{
          marginTop: 12,
          width: "100%",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid #0f172a",
          background: busy ? "#e2e8f0" : "#0f172a",
          color: busy ? "#0f172a" : "#ffffff",
          cursor: busy ? "not-allowed" : "pointer",
          fontWeight: 600,
        }}
      >
        {busy ? "Bezig…" : "Stuur login-link"}
      </button>

      {status ? <p style={{ color: "#475569", marginTop: 12 }}>{status}</p> : null}

      <p style={{ color: "#64748b", marginTop: 14, fontSize: 13 }}>
        Je wordt na het inloggen doorgestuurd naar: <code>{next}</code>
      </p>
    </main>
  );
}
