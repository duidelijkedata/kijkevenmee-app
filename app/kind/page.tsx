export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Button } from "@/components/ui";

export default async function KindHome() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    redirect("/kind/login");
  }

  // 🔐 Forceer naam-instelling bij eerste keer
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.display_name) {
    redirect("/kind/instellingen");
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Mijn omgeving</h1>
        <p className="text-slate-600">
          Start een sessie, beheer koppelingen of pas je instellingen aan.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold">Inbox</h2>
          <p className="mt-1 text-slate-600">Nieuwe verzoeken en screenshots.</p>
          <div className="mt-4">
            <Link href="/kind/inbox">
              <Button className="w-full">Open inbox</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Gekoppeld</h2>
          <p className="mt-1 text-slate-600">Met welke ouders/helpers ben je gekoppeld?</p>
          <div className="mt-4">
            <Link href="/kind/gekoppeld">
              <Button className="w-full">Bekijk koppelingen</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Instellingen</h2>
          <p className="mt-1 text-slate-600">Naam en WhatsApp-nummer.</p>
          <div className="mt-4">
            <Link href="/kind/instellingen">
              <Button className="w-full">Open instellingen</Button>
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
