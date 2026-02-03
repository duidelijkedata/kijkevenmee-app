"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";

type ProfileRow = {
  id: string;
  whatsapp: string | null;
  use_koppelcode: boolean | null;
};

export default function Instellingen() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const [whatsapp, setWhatsapp] = useState("");
  const [useKoppelcode, setUseKoppelcode] = useState(true);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setError(null);
      setLoading(true);

      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (!user) {
        setLoading(false);
        router.replace(`/kind/login?next=${encodeURIComponent("/kind/instellingen")}`);
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email ?? "");

      // Profiel kan bestaan of niet; instellingen mogen altijd werken
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, whatsapp, use_koppelcode")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>();

      if (prof) {
        setWhatsapp(prof.whatsapp || "");
        setUseKoppelcode(prof.use_koppelcode ?? true);
      } else {
        // default voor nieuwe users
        setUseKoppelcode(true);
      }

      setLoading(false);
    })();
  }, [supabase, router]);

  async function save() {
    setError(null);

    if (!userId) {
      setError("Log eerst in.");
      return;
    }

    setSaving(true);
    try {
      // Probeer eerst UPDATE (voorkomt INSERT issues)
      const { error: updErr } = await supabase
        .from("profiles")
        .update({
          whatsapp: whatsapp.trim() || null,
          use_koppelcode: useKoppelcode,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (!updErr) {
        router.replace("/kind");
        return;
      }

      // Als update faalt omdat row nog niet bestaat of door RLS edge case:
      // doe een insert/upsert met minimaal verplichte velden (email is NOT NULL in jouw schema)
      if (!userEmail) {
        setError("Je account heeft geen e-mailadres. Log opnieuw in.");
        return;
      }

      const { error: upsertErr } = await supabase.from("profiles").upsert({
        id: userId,
        email: userEmail, // ✅ nodig vanwege NOT NULL constraint
        whatsapp: whatsapp.trim() || null,
        use_koppelcode: useKoppelcode,
        updated_at: new Date().toISOString(),
      });

      if (upsertErr) {
        setError(upsertErr.message);
        return;
      }

      router.replace("/kind");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Instellingen</h1>
        <p className="text-slate-600">
          WhatsApp-nummer en hoe je een hulpsessie start.
        </p>
      </header>

      <Card>
        {loading ? (
          <p className="text-slate-700">Laden…</p>
        ) : (
          <div className="space-y-4">
            {error ? <p className="text-red-600">{error}</p> : null}

            <div>
              <label className="block text-sm font-medium text-slate-700">WhatsApp nummer</label>
              <div className="mt-1">
                <Input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="Bijv. +31612345678"
                />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Optioneel. Handig als je ouder je via WhatsApp wil bereiken.
              </p>
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
                    Meekijken starten met een code (6 cijfers)
                  </label>
                  <p className="mt-1 text-sm text-slate-600">
                    Als dit <b>aan</b> staat, dan moet de ouder de 6-cijferige code handmatig doorgeven en jij vult hem in bij{" "}
                    <b>Verbinden</b>. <br />
                    Als dit <b>uit</b> staat, dan kunnen gekoppelde ouders een hulpsessie starten <b>zonder</b> dat jij een code hoeft over te typen.
                  </p>
                </div>
              </div>
            </div>

            <Button variant="primary" className="w-full" onClick={save} disabled={saving}>
              {saving ? "Opslaan…" : "Opslaan"}
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
