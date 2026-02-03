"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function PresencePing({ intervalMs = 45000 }: { intervalMs?: number }) {
  useEffect(() => {
    const supabase = supabaseBrowser();
    let timer: any = null;
    let stopped = false;

    async function ping() {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid) return;

        await supabase
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", uid);
      } catch {
        // ignore
      }
    }

    ping();
    timer = setInterval(() => {
      if (!stopped) ping();
    }, intervalMs);

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);

  return null;
}
