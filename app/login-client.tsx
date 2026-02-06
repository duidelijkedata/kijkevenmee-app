"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithUsernamePassword } from "@/app/actions/auth";

export default function LoginClient() {
  const sp = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const next = sp.get("next") ?? "";
  const confirmed = sp.get("confirmed");
  const checkEmail = sp.get("check_email");
  const email = sp.get("email");
  const confirmError = sp.get("confirm_error");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    const fd = new FormData();
    fd.set("username", username);
    fd.set("password", password);
    if (next) fd.set("next", next);

    startTransition(async () => {
      const res = await signInWithUsernamePassword(fd);
      if (res && !res.ok) setStatus(res.error || "Er ging iets mis.");
      // bij succes gebeurt redirect server-side
    });
  }

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Inloggen</h1>

      {checkEmail ? (
        <p style={{ color: "#475569", marginTop: 0 }}>
          Check je e-mail{email ? ` (${email})` : ""} en klik op de bevestigingslink.
        </p>
      ) : null}

      {confirmed ? (
        <p style={{ color: "#166534", marginTop: 0 }}>
          E-mail bevestigd. Je kunt nu inloggen met je loginnaam en wachtwoord.
        </p>
      ) : null}

      {confirmError ? (
        <p style={{ color: "#b91c1c", marginTop: 0 }}>
          Bevestigen mislukt: <code>{confirmError}</code>
        </p>
      ) : null}

      <form onSubmit={onSubmit}>
        <label style={{ display: "block", margin: "16px 0 6px 0", color: "#0f172a" }}>
          Loginnaam
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="bijv. omaannie"
          autoComplete="username"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            outline: "none",
          }}
        />

        <label style={{ display: "block", margin: "12px 0 6px 0", color: "#0f172a" }}>
          Wachtwoord
        </label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          type="password"
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            outline: "none",
          }}
        />

        <button
          type="submit"
          disabled={isPending || username.trim().length < 3 || password.length < 8}
          style={{
            marginTop: 12,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #0f172a",
            background: isPending ? "#e2e8f0" : "#0f172a",
            color: isPending ? "#0f172a" : "#ffffff",
            cursor: isPending ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {isPending ? "Bezig…" : "Inloggen"}
        </button>
      </form>

      {status ? <p style={{ color: "#b91c1c", marginTop: 12 }}>{status}</p> : null}

      <p style={{ color: "#64748b", marginTop: 14, fontSize: 13 }}>
        Nog geen account? <a href="/aanmelden">Aanmelden</a>
      </p>

      {next ? (
        <p style={{ color: "#64748b", marginTop: 14, fontSize: 13 }}>
          Na login ga je naar: <code>{next}</code>
        </p>
      ) : null}
    </main>
  );
}
