"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // voorbeeld: pak "next" mee als je dat gebruikt (optioneel)
    const next = searchParams.get("next") ?? "/";

    // Als je hier al een fetch doet naar je API route om de sessie te zetten:
    // await fetch("/api/auth/session", { ... })
    // en daarna redirecten.

    router.replace(next);
  }, [router, searchParams]);

  return <div className="mx-auto max-w-md p-6">Bezig met inloggen…</div>;
}
