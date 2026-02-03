export const dynamic = "force-dynamic";

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, Button } from "@/components/ui";
import KindKoppelenClient from "./koppelen-client";

export default async function KindKoppelenPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Koppelen met ouder(s)</h1>
        <p className="text-slate-600">
          Plak hier de koppelcode die je van je ouder/helper hebt gekregen.
        </p>
      </header>

      {!user ? (
        <Card>
          <h2 className="text-xl font-semibold">Inloggen</h2>
          <p className="mt-1 text-slate-600">
            Log in met je e-mailadres. Je krijgt een link per mail.
          </p>
          <div className="mt-4">
            <Link href={`/kind/login?next=${encodeURIComponent("/kind/koppelen")}`}>
              <Button variant="primary" className="w-full">
                Naar login
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <KindKoppelenClient />

          <Card>
            <p className="text-slate-600">Na koppelen zie je je gekoppelde helpers in het overzicht.</p>
            <div className="mt-4 flex flex-col gap-2 md:flex-row">
              <Link href="/kind/gekoppeld" className="w-full md:w-auto">
                <Button className="w-full md:w-auto">Gekoppelde helpers</Button>
              </Link>
              <Link href="/kind" className="w-full md:w-auto">
                <Button className="w-full md:w-auto">Terug</Button>
              </Link>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
