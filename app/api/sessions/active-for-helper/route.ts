import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // kind-instelling: moet code gebruikt worden?
  const { data: prof } = await supabase
    .from("profiles")
    .select("use_koppelcode")
    .eq("id", user.id)
    .maybeSingle<{ use_koppelcode: boolean | null }>();

  const use_koppelcode = prof?.use_koppelcode ?? true;

  /**
   * ✅ Belangrijk:
   * Kind mag pas een "actieve sessie" zien als de ouder de sessie echt gestart heeft.
   * Daarom filteren we op parent_started_at != null.
   *
   * We houden status='open' aan, omdat jullie dat al gebruiken als "actief".
   * (Als jullie status later 'started'/'active' gaan gebruiken kun je dat hier aanpassen.)
   */
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, code, status, created_at, requester_name, parent_started_at")
    .eq("helper_id", user.id)
    .eq("status", "open")
    .not("parent_started_at", "is", null)
    .order("parent_started_at", { ascending: false })
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ use_koppelcode, sessions: sessions ?? [] });
}
