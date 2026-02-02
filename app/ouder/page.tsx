"use client";

import { useMemo, useState } from "react";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function OuderStart() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<{ code: string; url: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    const res = await fetch("/api/sessions/create-parent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requester_name: name || null, requester_note: note || null }),
    });
    const json = await res.json();
    setLoading(false);
    if (json.error) return alert(json.error);

    const code = json.session.code as string;
    setCreated({ code, url: `${location.origin}/join/${code}` });
  }

  const waText = created ? encodeURIComponent(`Klik op deze link om mee te kijken: ${created.url}`) : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Vraag hulp aan je kind</h1>
        <p className="text-slate-600">
          Je kind kan veilig meekijken met je scherm om je te helpen. Je kind kan niets aanklikken of overnemen.
        </p>
      </header>

      {!created ? (
        <Card>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Naam (optioneel)</label>
              <div className="mt-1">
                <Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Bijv. Jan" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Korte vraag (optioneel)</label>
              <div className="mt-1">
                <Textarea value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Bijv. Ik moet inloggen met DigiD" />
              </div>
            </div>
            <Button variant="primary" className="w-full" onClick={start} disabled={loading}>
              {loading ? "Bezig..." : "Start hulp"}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="text-xl font-semibold">Geef deze code aan je kind</h2>
            <p className="mt-1 text-slate-600">Je kind gebruikt deze code om met je mee te kijken.</p>
            <div className="mt-4 rounded-2xl bg-slate-50 border p-4 text-center">
              <div className="text-4xl font-mono tracking-widest">
                {created.code.slice(0,3)} {created.code.slice(3)}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a className="h-12 rounded-xl border bg-white hover:bg-slate-50 flex items-center justify-center font-medium"
                 href={`https://wa.me/?text=${waText}`} target="_blank">
                Stuur via WhatsApp
              </a>
              <Button
                onClick={() => navigator.clipboard.writeText(created.url)}
                className="w-full"
              >
                Kopieer link
              </Button>
            </div>

            <div className="mt-4 text-sm text-slate-600 break-all">
              Link: <span className="font-mono">{created.url}</span>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold">Scherm delen</h2>
            <p className="mt-1 text-slate-600">
              Je kunt altijd stoppen. Je kind kan alleen meekijken, niet klikken of typen.
            </p>
            <div className="mt-4">
              <a href={`/join/${created.code}`} className="block">
                <Button variant="primary" className="w-full">Ga naar scherm delen</Button>
              </a>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
