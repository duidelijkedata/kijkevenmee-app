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

  // Als iemand tóch een link plakt zoals https://.../join/KEM-ABC123 → pak de code uit de URL
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

type Msg = { kind: "ok" | "err" | "info"; text: string };

export default function KindKoppelenClient() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function fetchHelperIds(uid: string) {
    const { data, error } = await supabase
      .from("helper_relationships")
      .select("helper_id")
      .eq("child_id", uid);

    if (error) throw error;
    return (data ?? []).map((r: any) => r.helper_id).filter(Boolean) as string[];
  }

  async function fetchProfileName(id: string) {
    const { data, error } = await supabase.from("profiles").select("id, display_name").eq("id", id).maybeSingle();
    if (error) return null;
    return (data?.display_name as string | null) ?? null;
  }

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

      // 1) Helpers vóór accept (om te kunnen diffen)
      let before: string[] = [];
      try {
        before = await fetchHelperIds(uid);
      } catch {
        // niet fatal; koppelen kan alsnog slagen
      }

      // 2) Accept via jouw bestaande RPC
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

      // 3) Helpers ná accept → vind nieuw gekoppelde helper
      let helperName: string | null = null;
      try {
        const after = await fetchHelperIds(uid);
        const newlyAdded = after.find((id) => !before.includes(id)) ?? null;

        if (newlyAdded) {
          helperName = await fetchProfileName(newlyAdded);
        }
      } catch {
        // ignore; we tonen dan generiek succes
      }

      const label = helperName ? `Gekoppeld met ${helperName}.` : "✅ Gelukt! Je bent nu gekoppeld.";
      setMsg({ kind: "ok", text: label });

      // Laat het even zichtbaar zijn, daarna door naar overzicht
      setTimeout(() => {
        router.replace("/kind/gekoppeld");
      }, 900);
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

        <Button variant="primary" onClick={onKoppelen} disabled={busy}>
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
