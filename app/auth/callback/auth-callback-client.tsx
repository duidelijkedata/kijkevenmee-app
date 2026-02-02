"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function parseHashParams(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const sp = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  sp.forEach((v, k) => (out[k] = v));
  return out;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [status, setStatus] = useState("Bezig met inloggen…");

  useEffect(() => {
    const run = async () => {
      const next = sp.get("next") ?? "/kind";

      const hash = parseHashParams(window.location.hash || "");

      const hasImplicit = !!(hash["access_token"] && hash["refresh_token"]);
      const hasOtp = !!(hash["token_hash"] && hash["type"]);

      if (!hasImplicit && !hasOtp) {
        router.replace(`/kind/login?error=missing_callback_params`);
        return;
      }

      setStatus("Sessie opslaan…");

      const payload = hasImplicit
        ? { access_token: hash["access_token"], refresh_token: hash["refresh_token"] }
        : { token_hash: hash["token_hash"], type: hash["type"] };

      const r = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        router.replace(`/kind/login?error=session_cookie_failed`);
        return;
      }

      // Hash opruimen (voorkomt dubbele verwerking bij refresh)
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?next=${encodeURIComponent(next)}`
      );

      setStatus("Gelukt! Doorsturen…");
      router.replace(next);
    };

    run();
  }, [router, sp]);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px 0" }}>Inloggen</h1>
      <p style={{ color: "#475569", margin: 0 }}>{status}</p>
    </main>
  );
}
