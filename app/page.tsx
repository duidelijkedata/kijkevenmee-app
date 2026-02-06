import { Suspense } from "react";
import LoginClient from "./login-client";

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-50 text-slate-900">
          <header className="px-6 pt-6">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-2xl bg-indigo-600 shadow-lg flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6 text-white"
                >
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
              <div className="rounded-[40px] bg-white/90 shadow-[0_25px_60px_rgba(15,23,42,0.10)] ring-1 ring-slate-200/60 px-8 py-10">
                <div className="text-center">
                  <h1 className="text-4xl font-semibold tracking-tight">Inloggen</h1>
                  <p className="mt-2 text-slate-500">Laden…</p>
                </div>
              </div>
            </div>
          </div>

          <footer className="pb-10 text-center text-xs text-slate-400">
            © 2024 Kijk even mee. Eenvoudig en veilig.
          </footer>
        </main>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
