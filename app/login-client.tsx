"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { signInWithUsernamePassword } from "@/app/actions/auth";

function Alert({ kind, children }: { kind: "info" | "success" | "error"; children: React.ReactNode }) {
  const base = "rounded-2xl px-4 py-3 text-sm ring-1";
  if (kind === "success") {
    return <div className={`${base} bg-emerald-50 text-emerald-900 ring-emerald-200`}>{children}</div>;
  }
  if (kind === "error") {
    return <div className={`${base} bg-rose-50 text-rose-900 ring-rose-200`}>{children}</div>;
  }
  return <div className={`${base} bg-slate-50 text-slate-700 ring-slate-200`}>{children}</div>;
}

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

  const canSubmit = username.trim().length >= 3 && password.length >= 8 && !isPending;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="px-6 pt-6">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-2xl bg-indigo-600 shadow-lg flex items-center justify-center">
            {/* simple 'users' glyph so we don't depend on an icon lib */}
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white">
              <path
                d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3ZM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h7v-2.5C24 14.17 19.33 13 16 13Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-semibold leading-none">Kijk even mee</div>
            <div className="mt-1 text-xs font-semibold tracking-widest text-slate-400">REMOTE ASSISTENTIE</div>
          </div>
        </div>
      </header>

      <div className="px-6 pb-10 pt-10">
        <div className="mx-auto w-full max-w-[560px]">
          <div className="rounded-[40px] bg-white/90 shadow-[0_25px_60px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/60 px-8 py-10 sm:px-12 sm:py-12">
            <div className="text-center">
              <h1 className="text-4xl font-semibold tracking-tight">Welkom</h1>
              <p className="mt-2 text-slate-500">Log in om uw dashboard te openen</p>
            </div>

            <div className="mt-6 space-y-3">
              {checkEmail ? (
                <Alert kind="info">Check je e-mail{email ? ` (${email})` : ""} en klik op de bevestigingslink.</Alert>
              ) : null}

              {confirmed ? (
                <Alert kind="success">E-mail bevestigd. Je kunt nu inloggen met je loginnaam en wachtwoord.</Alert>
              ) : null}

              {confirmError ? (
                <Alert kind="error">
                  Bevestigen mislukt: <code className="font-mono text-xs">{confirmError}</code>
                </Alert>
              ) : null}

              {status ? <Alert kind="error">{status}</Alert> : null}
            </div>

            <form onSubmit={onSubmit} className="mt-8">
              <label className="block text-sm font-semibold text-slate-900">Loginnaam</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Uw loginnaam"
                autoComplete="username"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />

              <label className="mt-6 block text-sm font-semibold text-slate-900">Wachtwoord</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Uw wachtwoord"
                type="password"
                autoComplete="current-password"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              />

              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-8 w-full rounded-2xl bg-indigo-600 px-5 py-4 text-base font-semibold text-white shadow-[0_14px_30px_rgba(79,70,229,0.35)] transition active:translate-y-[1px] disabled:cursor-not-allowed disabled:bg-indigo-200 disabled:text-indigo-700 disabled:shadow-none"
              >
                {isPending ? "Bezig…" : "Inloggen"}
              </button>

              <div className="mt-5 text-center">
                {/* Route optional — if it doesn't exist yet, this will 404, but layout stays correct */}
                <a
                  href="/wachtwoord-vergeten"
                  className="text-sm font-medium text-slate-400 hover:text-slate-600"
                >
                  Wachtwoord vergeten?
                </a>
              </div>

              <div className="mt-10 flex items-center gap-4">
                <div className="h-px flex-1 bg-slate-100" />
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-4 py-2 text-[11px] font-semibold tracking-widest text-slate-400 ring-1 ring-slate-200">
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4">
                    <path
                      d="M17 9V7a5 5 0 0 0-10 0v2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6 9h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                  VEILIGE TOEGANG
                </div>
                <div className="h-px flex-1 bg-slate-100" />
              </div>

              <p className="mt-8 text-center text-sm text-slate-400">
                Nog geen account?{" "}
                <a href="/aanmelden" className="font-semibold text-slate-500 hover:text-slate-700">
                  Aanmelden
                </a>
              </p>

              {next ? (
                <p className="mt-4 text-center text-xs text-slate-400">
                  Na login ga je naar: <code className="font-mono">{next}</code>
                </p>
              ) : null}
            </form>
          </div>
        </div>
      </div>

      <footer className="pb-10 text-center text-xs text-slate-400">© 2024 Kijk even mee. Eenvoudig en veilig.</footer>
    </main>
  );
}
