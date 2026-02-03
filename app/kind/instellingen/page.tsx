"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ProfileRow = {
  id: string;
  display_name: string | null;
  whatsapp: string | null;
  use_koppelcode: boolean | null;
};

export default function Instellingen() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [loading, setLoading] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [useKoppelcode, setUseKoppelcode] = useState(true);

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

      const { data: prof } = await supabase
        .from("profiles")
        .select("id, display_name, whatsapp, use_koppelcode")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>();

      if (prof) {
        setDisplayName(prof.display_name || "");
        setWhatsapp(prof.whatsapp || "");
        // default: AAN (true) als kolom nog null is
        setUseKoppelcode(prof.use_koppelcode ?? true);
      } else {
        setUseKoppelcode(true);
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
      use_koppelcode: useKoppelcode,
      updated_at: new Date().toISOString(),
    });

    if (error) alert(error.message);
    else alert("Opgeslagen ✅");
  }

  return (
    <main className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Instellingen</h1>
        <p className="text-slate-600">Naam, WhatsApp-nummer en (optioneel) koppelen.</p>
      </header>

      <Card>
        {loading ? (
          <p className="text-slate-700">Laden…</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Jouw naam</label>
              <div className="mt-1">
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Bijv. Mark (zoon)"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">WhatsApp nummer</label>
              <div className="mt-1">
                <Input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="Bijv. +31612345678"
                />
              </div>
            </div>

            <div className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <input
                  id="use_koppelcode"
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={useKoppelcode}
                  onChange={(e) => setUseKoppelcode(e.target.checked)}
                />
                <div className="flex-1">
                  <label htmlFor="use_koppelcode" className="block font-medium text-slate-900">
                    Koppelen met ouder via koppelcode
                  </label>
                  <p className="mt-1 text-sm text-slate-600">
                    Als dit <b>uit</b> staat, dan werkt koppelen via een link/"koppelcode" niet. Dan kan je ouder nog
                    steeds hulp vragen met de <b>eenmalige meekijkcode</b> (6 cijfers) – dat is vaak makkelijker.
                  </p>
                </div>
              </div>
            </div>

            <Button variant="primary" className="w-full" onClick={save}>
              Opslaan
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
