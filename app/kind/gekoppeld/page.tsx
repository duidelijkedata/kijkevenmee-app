export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense } from "react";
import { Card, Button } from "@/components/ui";
import GekoppeldClient from "./gekoppeld-client";

export default function KindGekoppeldPage() {
  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Gekoppelde ouders/helpers</h1>
        <p className="text-slate-600">
          Hier zie je met welke ouder(s)/helper(s) je account gekoppeld is.
        </p>
      </header>

      <Suspense fallback={<div className="text-slate-600">Laden…</div>}>
        <GekoppeldClient />
      </Suspense>

      <Card>
        <div className="flex flex-col gap-2 md:flex-row">
          <Link href="/kind" className="w-full md:w-auto">
            <Button className="w-full md:w-auto">Terug naar mijn omgeving</Button>
          </Link>
          <Link href="/kind/verbinden" className="w-full md:w-auto">
            <Button variant="primary" className="w-full md:w-auto">Naar meekijken / verbinden</Button>
          </Link>
        </div>
      </Card>
    </main>
  );
}
