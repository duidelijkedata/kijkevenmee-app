"use client";

import { useEffect, useMemo, useState } from "react";

type CreateParentResponse =
  | { session: { id: string; code: string; status: string; helper_id?: string | null } }
  | { error: string };

function formatCode(v: string) {
  const digits = String(v ?? "").replace(/\D/g, "").slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export default function OuderPage() {
  const [requesterName, setRequesterName] = useState("");
  const [requesterNote, setRequesterNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [sessionHelperId, setSessionHelperId] = useState<string | null>(null);

  // ✅ helper_id uit URL halen (voor no-code flow)
  const helperIdFromUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("helper_id") || sp.get("helper") || sp.get("hid");
    return v && v.trim().length > 0 ? v.trim() : null;
  }, []);

  // Als er helper_id in URL staat, bewaren we hem ook lokaal (handig als ouder refresh doet)
  useEffect(() => {
    if (!helperIdFromUrl) return;
    try {
      localStorage.setItem("kijkevenmee_helper_id", helperIdFromUrl);
    } catch {}
  }, [helperIdFromUrl]);

  // Als er geen helper_id in URL staat, probeer uit localStorage
  const helperId = useMemo(() => {
    if (helperIdFromUrl) return helperIdFromUrl;
    if (typeof window === "undefined") return null;
    try {
      const v = localStorage.getItem("kijkevenmee_helper_id");
      return v && v.trim().length > 0 ? v.trim() : null;
    } catch {
      return null;
    }
  }, [helperIdFromUrl]);

  async function createSession() {
    setErr(null);
    setBusy(true);

    try {
      const payload: any = {
        requester_name: requesterName || null,
        requester_note: requesterNote || null,
      };

      // ✅ Cruciaal: als helper_id bekend is, sturen we hem mee
      // Hierdoor krijgt de sessie helper_id en verschijnt hij bij Kind onder “Actieve sessies”.
      if (helperId) payload.helper_id = helperId;

      const res = await fetch("/api/sessions/create-parent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json().catch(() => ({}))) as CreateParentResponse;

      if (!res.ok) {
        const msg = (json as any)?.error || `Request failed (${res.status})`;
        setErr(msg);
        return;
      }

      const sess = (json as any)?.session;
      if (!sess?.id || !sess?.code) {
        setErr("Ongeldige response van server (geen sessie).");
        return;
      }

      setSessionId(sess.id);
      setSessionCode(sess.code);
      setSessionHelperId(sess.helper_id ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Onbekende fout");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setErr(null);
    setSessionId(null);
    setSessionCode(null);
    setSessionHelperId(null);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 text-slate-900">
      <h1 className="text-2xl font-semibold">Meekijken starten</h1>

      <div className="mt-2 text-slate-600">
        {helperId ? (
          <>
            Je hebt een gekoppelde helper. Je kunt een hulpsessie starten zonder dat het kind een code hoeft over te typen.
          </>
        ) : (
          <>
            Geen helper-id gevonden. Je kunt nog steeds starten met een code (die je handmatig doorgeeft).
            <div className="mt-1 text-xs text-slate-500">
              Tip: gebruik een link als <span className="font-mono">/ouder?helper_id=...</span> om no-code te activeren.
            </div>
          </>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {!sessionId ? (
          <>
            <div className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-slate-600">Jouw naam (optioneel)</span>
                <input
                  className="h-11 rounded-xl border border-slate-200 px-3 outline-none focus:border-slate-400"
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  placeholder="Bijv. Mama / Opa / …"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm text-slate-600">Vraag / toelichting (optioneel)</span>
                <textarea
                  className="min-h-[90px] rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400"
                  value={requesterNote}
                  onChange={(e) => setRequesterNote(e.target.value)}
                  placeholder="Waar heb je hulp bij?"
                />
              </label>

              {helperId ? (
                <div className="text-xs text-slate-500">
                  Helper id: <span className="font-mono">{helperId}</span>
                </div>
              ) : null}

              {err ? (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">{err}</div>
              ) : null}

              <button
                onClick={createSession}
                disabled={busy}
                className="h-11 rounded-xl bg-slate-900 text-white disabled:opacity-60"
              >
                {busy ? "Bezig…" : "Start hulpsessie"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-600">Sessie gestart</div>

            <div className="mt-2 grid gap-2">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Sessie ID</div>
                <div className="font-mono text-sm">{sessionId}</div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Code</div>
                <div className="font-mono text-xl tracking-widest">{formatCode(sessionCode || "")}</div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => copy(String(sessionCode))}
                    className="h-10 rounded-xl border border-slate-200 px-3"
                  >
                    Kopieer code
                  </button>

                  <button
                    onClick={() => copy(formatCode(sessionCode || ""))}
                    className="h-10 rounded-xl border border-slate-200 px-3"
                  >
                    Kopieer “123 456”
                  </button>
                </div>

                <div className="mt-3 text-sm text-slate-600">
                  {sessionHelperId || helperId ? (
                    <>
                      ✅ Deze sessie is gekoppeld aan een helper. Het kind ziet hem onder <b>Actieve sessies</b> en hoeft niets
                      over te typen.
                    </>
                  ) : (
                    <>
                      ℹ️ Deze sessie is niet gekoppeld aan een helper. Geef de code handmatig door.
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={reset} className="h-10 rounded-xl border border-slate-200 px-3">
                  Nieuwe sessie
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
