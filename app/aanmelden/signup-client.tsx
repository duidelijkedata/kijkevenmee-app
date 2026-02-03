"use client";

import { useState, useTransition } from "react";
import { signUpEmailUsernamePassword } from "@/app/actions/auth";

export default function SignupClient() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ouder" | "kind">("kind");
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    const fd = new FormData();
    fd.set("email", email);
    fd.set("username", username);
    fd.set("password", password);
    fd.set("role", role);

    startTransition(async () => {
      const res = await signUpEmailUsernamePassword(fd);
      if (res && !res.ok) setStatus(res.error || "Er ging iets mis.");
      // succes -> redirect server-side naar /login?check_email=1
    });
  }

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Aanmelden</h1>
      <p style={{ color: "#475569", marginTop: 0 }}>
        Maak een account. Je ontvangt een bevestigingsmail.
      </p>

      <form onSubmit={onSubmit}>
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

        <label style={{ display: "block", margin: "12px 0 6px 0", color: "#0f172a" }}>
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
          placeholder="minimaal 8 tekens"
          type="password"
          autoComplete="new-password"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            outline: "none",
          }}
        />

        <label style={{ display: "block", margin: "12px 0 6px 0", color: "#0f172a" }}>
          Profiel
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as any)}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            outline: "none",
            background: "#fff",
          }}
        >
          <option value="kind">Kind</option>
          <option value="ouder">Ouder</option>
        </select>

        <button
          type="submit"
          disabled={isPending || !email.includes("@") || username.trim().length < 3 || password.length < 8}
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
          {isPending ? "Bezig…" : "Account maken"}
        </button>
      </form>

      {status ? <p style={{ color: "#b91c1c", marginTop: 12 }}>{status}</p> : null}

      <p style={{ color: "#64748b", marginTop: 14, fontSize: 13 }}>
        Heb je al een account? <a href="/login">Inloggen</a>
      </p>
    </main>
  );
}
