"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function Instellingen() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (prof) {
        setDisplayName(prof.display_name || "");
        setWhatsapp(prof.whatsapp || "");
      }
      setLoading(false);
    })();
  }, [supabase]);

  async function save() {
    if (!userId) return alert("Log eerst in.");
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      display_name: displayName || null,
      whatsapp: whatsapp || null,
      updated_at: new Date().toISOString(),
    });
    if (error) alert(error.message);
    else alert("Opgeslagen ✅");
  }

  return (
    <main className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Instellingen</h1>
        <p className="text-slate-600">Naam en WhatsApp-nummer.</p>
      </header>

      <Card>
        {loading ? (
          <p className="text-slate-700">Laden…</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Jouw naam</label>
              <div className="mt-1">
                <Input value={displayName} onChange={(e)=>setDisplayName(e.target.value)} placeholder="Bijv. Mark (zoon)" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">WhatsApp nummer</label>
              <div className="mt-1">
                <Input value={whatsapp} onChange={(e)=>setWhatsapp(e.target.value)} placeholder="Bijv. +31612345678" />
              </div>
            </div>
            <Button variant="primary" className="w-full" onClick={save}>Opslaan</Button>
          </div>
        )}
      </Card>
    </main>
  );
}
