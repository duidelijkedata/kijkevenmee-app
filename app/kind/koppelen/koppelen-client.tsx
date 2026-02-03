"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Card, Button, Input } from "@/components/ui";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createBrowserClient(url, anon);
}

function normalizeCode(raw: string) {
  const s = (raw || "").trim();
  if (!s) return "";

  // Als iemand tóch een link plakt zoals https://.../join/KEM-ABC123 → pak code uit URL
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "join");
      if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]).toUpperCase();
    }
  } catch {
    // ignore
  }

  return s.toUpperCase().replace(/\s+/g, "");
}

export default function KindKoppelenClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  async function onKoppelen() {
    setMsg(null);

    const c = normalizeCode(code);
    if (!c) {
      setMsg({ kind: "err", text: "Plak een koppelcode." });
      return;
    }

    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;

      if (!uid) {
        router.replace(`/kind/login?next=${encodeURIComponent("/kind/koppelen")}`);
        return;
      }

      const { error } = await supabase.rpc("accept_helper_invite", { p_code: c });

      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("invite_not_found_or_expired")) {
          setMsg({
            kind: "err",
            text: "Deze koppelcode bestaat niet (meer) of is verlopen. Vraag je ouder om een nieuwe code.",
          });
        } else {
          setMsg({ kind: "err", text: `Koppelen mislukt: ${error.message}` });
        }
        return;
      }

      setMsg({ kind: "ok", text: "✅ Gelukt! Je bent nu gekoppeld." });
      router.replace("/kind/gekoppeld");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Koppelcode ouder(s)</h2>
      <p className="mt-1 text-slate-600">
        Plak de code die je hebt gekregen (bijv. <span className="font-mono">KEM-ABC123</span>).
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Plak koppelcode…"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />

        <Button onClick={onKoppelen} disabled={busy}>
          {busy ? "Bezig…" : "Koppelen"}
        </Button>

        {msg ? (
          <p className={msg.kind === "ok" ? "text-green-600" : msg.kind === "err" ? "text-red-600" : "text-slate-600"}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
