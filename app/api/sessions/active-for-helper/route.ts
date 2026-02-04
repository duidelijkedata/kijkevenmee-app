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

  // ✅ belangrijk voor scenario "geen code": Kind moet weten of use_koppelcode aan/uit staat
  const { data: prof } = await supabase
    .from("profiles")
    .select("use_koppelcode")
    .eq("id", user.id)
    .maybeSingle<{ use_koppelcode: boolean | null }>();

  const use_koppelcode = prof?.use_koppelcode ?? true;

  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, code, status, created_at")
    .eq("helper_id", user.id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ use_koppelcode, sessions: sessions ?? [] });
}
