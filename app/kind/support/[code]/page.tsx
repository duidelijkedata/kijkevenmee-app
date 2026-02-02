"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

type Msg = {
  id: string;
  sender: "parent" | "child";
  body: string;
  created_at: string;
};

export default function KindSupportChatPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const supabase = useMemo(() => {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }, []);

  useEffect(() => {
    if (!code) return;
    (async () => {
      const r = await fetch(`/api/support/${code}/messages`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessages([{ id: "err", sender: "child", body: "Sessie niet gevonden of gesloten.", created_at: new Date().toISOString() }]);
        return;
      }
      setSessionId(j.session_id);
      setMessages(j.messages ?? []);
    })();
  }, [code]);

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`support_messages:${sessionId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || !code) return;

    const r = await fetch(`/api/kind/support/${code}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: trimmed }),
    });

    if (r.ok) setText("");
  }

  const shareLink = typeof window !== "undefined" && code ? `${window.location.origin}/s/${code}` : "";

  return (
    <div style={{ maxWidth: 720, margin: "24px auto", fontFamily: "system-ui", padding: "0 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: "0 0 12px 0" }}>Chat {code}</h1>
        <Link href="/kind/support">← Terug</Link>
      </div>

      {shareLink && (
        <div style={{ marginBottom: 10, fontSize: 13, color: "#64748b" }}>
          Deel met ouder: <code>{shareLink}</code>
        </div>
      )}

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, height: 420, overflow: "auto" }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {m.sender === "parent" ? "Ouder" : "Jij"} • {new Date(m.created_at).toLocaleTimeString()}
            </div>
            <div
              style={{
                padding: "8px 10px",
                background: m.sender === "child" ? "#eef2ff" : "#f8fafc",
                borderRadius: 10,
                display: "inline-block",
              }}
            >
              {m.body}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Typ je antwoord…"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", background: "white" }}>
          Verstuur
        </button>
      </div>
    </div>
  );
}
