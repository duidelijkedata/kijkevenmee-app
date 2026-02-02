"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Card, Button, Input } from "@/components/ui";

export default function LoginClient() {
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devLink, setDevLink] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function login() {
    if (!email || loading || cooldown > 0) return;

    setLoading(true);

    try {
      // ✅ altijd via callback zodat sessie-cookie gezet wordt
      const redirectTo = `${location.origin}/auth/callback?next=/kind`;

      // DEV: geen e-mail versturen -> magic link genereren via eigen API
      if (process.env.NODE_ENV === "development") {
        const res = await fetch("/api/dev/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, redirectTo }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to generate link");

        const link = json.action_link as string | undefined;
        if (!link) throw new Error("No action_link returned from API");

        setDevLink(link);
        setSent(true);
        setCooldown(10);

        // Ga naar Supabase link -> terug via /auth/callback -> /kind
        window.location.href = link;
        return;
      }

      // PROD: echte mail
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });

      if (error) throw new Error(error.message);

      setSent(true);
      setCooldown(60);
    } catch (e: any) {
      alert(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  const buttonText = loading
    ? "Bezig..."
    : cooldown > 0
    ? `Wacht ${cooldown}s...`
    : "Stuur login-link";

  const isDev = process.env.NODE_ENV === "development";

  return (
    <main className="mx-auto max-w-lg space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Inloggen</h1>

      <Card>
        {/* Password managers (bv LastPass) injecteren soms HTML => hydration warnings */}
        <div suppressHydrationWarning>
          {!sent ? (
            <>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                E-mailadres
              </label>

              <div className="mt-2">
                <Input
                  id="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="naam@voorbeeld.nl"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                />
              </div>

              <div className="mt-4">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={login}
                  disabled={!email || loading || cooldown > 0}
                >
                  {buttonText}
                </Button>
              </div>

              <p className="mt-3 text-sm text-slate-600">
                {isDev
                  ? "Dev-modus: je logt direct in via een magic link (geen e-mail verstuurd)."
                  : "Je ontvangt een e-mail met een link om in te loggen."}
              </p>
            </>
          ) : (
            <>
              <p className="text-slate-700">
                {isDev
                  ? "Dev-modus: je wordt doorgestuurd. Als dat niet gebeurt, gebruik de link hieronder."
                  : "Check je e-mail. Klik op de login-link om verder te gaan."}
                {cooldown > 0 ? ` (Je kunt over ${cooldown}s opnieuw sturen.)` : ""}
              </p>

              {isDev && devLink ? (
                <p className="mt-3 break-all text-sm">
                  <a className="underline" href={devLink}>
                    Open magic link
                  </a>
                </p>
              ) : null}
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
