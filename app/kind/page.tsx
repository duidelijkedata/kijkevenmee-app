export const dynamic = "force-dynamic";

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Button } from "@/components/ui";

export default async function KindHome() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Mijn omgeving</h1>
        <p className="text-slate-600">Overzicht van verzoeken, historie, koppelingen en meekijken.</p>
      </header>

      {!user ? (
        <Card>
          <h2 className="text-xl font-semibold">Inloggen</h2>
          <p className="mt-1 text-slate-600">Log in met je e-mailadres. Je krijgt een link per mail.</p>
          <div className="mt-4">
            <Link href="/kind/login">
              <Button variant="primary" className="w-full">Naar login</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <h2 className="text-lg font-semibold">Inbox</h2>
            <p className="mt-1 text-slate-600">Nieuwe verzoeken en screenshots.</p>
            <div className="mt-4">
              <Link href="/kind/inbox"><Button className="w-full">Open inbox</Button></Link>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Historie</h2>
            <p className="mt-1 text-slate-600">Eerdere hulpsessies.</p>
            <div className="mt-4">
              <Link href="/kind/historie"><Button className="w-full">Bekijk historie</Button></Link>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Meekijken</h2>
            <p className="mt-1 text-slate-600">Ga naar het meekijk-scherm en vul een code in.</p>
            <div className="mt-4">
              <Link href="/kind/verbinden"><Button className="w-full" variant="primary">Verbinden</Button></Link>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Koppelen</h2>
            <p className="mt-1 text-slate-600">Koppel met ouder(s) via koppelcode.</p>
            <div className="mt-4 flex flex-col gap-2">
              <Link href="/kind/koppelen"><Button className="w-full">Koppelcode plakken</Button></Link>
              <Link href="/kind/gekoppeld"><Button className="w-full">Gekoppelde ouders</Button></Link>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
