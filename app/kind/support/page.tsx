"use client";

import { useState } from "react";

export default function KindSupportIndex() {
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  async function createSession() {
    const r = await fetch("/api/support/create", { method: "POST" });
    const j = await r.json();

    if (!r.ok) return;

    setCode(j.code);
    setLink(`${window.location.origin}/s/${j.code}`);
  }

  return (
    <div style={{ maxWidth: 720, margin: "24px auto", fontFamily: "system-ui", padding: "0 12px" }}>
      <h1 style={{ margin: "0 0 12px 0" }}>Support</h1>

      <button
        onClick={createSession}
        style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", background: "white" }}
      >
        Start hulpsessie
      </button>

      {link && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: "#64748b", fontSize: 13 }}>Deel deze link met je ouder:</div>
          <code style={{ display: "block", padding: 10, background: "#f8fafc", borderRadius: 10 }}>{link}</code>
          <div style={{ marginTop: 10 }}>
            <a href={`/kind/support/${code}`}>Open kind-chat →</a>
          </div>
        </div>
      )}
    </div>
  );
}
