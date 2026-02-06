import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user ?? null;

  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rawCode = String(body?.code ?? "");
  const code = rawCode.replace(/\D/g, "");

  if (code.length !== 6) {
    return NextResponse.json({ error: "code_required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // ✅ Stop delen: maak de sessie weer "niet gestart" zodat kind terugvalt naar idle.
  // We laten status op 'open', zodat dezelfde sessie later opnieuw gestart kan worden
  // (bij opnieuw klikken op 'Delen').
  const { data: session, error } = await admin
    .from("sessions")
    .update({ parent_started_at: null })
    .eq("code", code)
    .eq("status", "open")
    .select("id, code, status, helper_id, requester_name, created_at, parent_started_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ session: session ?? null });
}
