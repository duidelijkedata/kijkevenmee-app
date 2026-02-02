"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Button, Input, Textarea } from "@/components/ui";

export default function OuderStart() {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<{ code: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);

    // LET OP: dit endpoint moet bestaan in jouw repo (zoals je nu al gebruikt).
    const res = await fetch("/api/sessions/create-parent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requester_name: name || null, requester_note: note || null }),
    });

    const json = await res.json();
    setLoading(false);

    if (json.error) return alert(json.error);

    const code = json.session.code as string; // verwacht: "123456"
    setCreated({ code });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = created ? `${origin}/ouder/share/${created.code}` : "";
  const kidUrl = created ? `${origin}/kind/verbinden` : "";
  const waText = created
    ? encodeURIComponent(
        `Meekijken code: ${created.code.slice(0, 3)} ${created.code.slice(3)}\n\nKind opent: ${kidUrl}\n\nOuder scherm delen: ${shareUrl}`
      )
    : "";

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Vraag hulp aan je kind</h1>
        <p className="text-slate-600">
          Je kind kan veilig meekijken met je scherm om je te helpen. Je kind kan niets aanklikken of overnemen.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">Koppel een kind</h2>
          <p className="mt-1 text-slate-600">Maak een koppelcode en verbind accounts.</p>
          <div className="mt-4">
            <Link href="/ouder/koppelen">
              <Button className="w-full">Naar koppelen</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Gekoppelde kinderen</h2>
          <p className="mt-1 text-slate-600">Bekijk met welke kinderen je gekoppeld bent.</p>
          <div className="mt-4">
            <Link href="/ouder/gekoppeld">
              <Button className="w-full">Bekijk koppelingen</Button>
            </Link>
          </div>
        </Card>
      </div>

      {!created ? (
        <Card>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Naam (optioneel)</label>
              <div className="mt-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Jan" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Korte vraag (optioneel)</label>
              <div className="mt-1">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Bijv. Ik moet inloggen met DigiD"
                />
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
            <p className="mt-1 text-slate-600">Kind gaat naar <span className="font-mono">/kind/verbinden</span> en vult de code in.</p>

            <div className="mt-4 rounded-2xl bg-slate-50 border p-4 text-center">
              <div className="text-4xl font-mono tracking-widest">
                {created.code.slice(0, 3)} {created.code.slice(3)}
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a
                className="h-12 rounded-xl border bg-white hover:bg-slate-50 flex items-center justify-center font-medium"
                href={`https://wa.me/?text=${waText}`}
                target="_blank"
                rel="noreferrer"
              >
                Stuur via WhatsApp
              </a>
              <Button
                onClick={() => navigator.clipboard.writeText(`Code: ${created.code}\nKind: ${kidUrl}\nOuder: ${shareUrl}`)}
                className="w-full"
              >
                Kopieer info
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="text-xl font-semibold">Scherm delen</h2>
            <p className="mt-1 text-slate-600">
              Klik hieronder om je scherm te delen. Je kind kan alleen kijken.
            </p>
            <div className="mt-4">
              <Link href={`/ouder/share/${created.code}`} className="block">
                <Button variant="primary" className="w-full">Ga naar scherm delen</Button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
