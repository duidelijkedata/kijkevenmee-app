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
  const code = String(body?.code ?? "").replace(/\D/g, "");

  if (code.length !== 6) {
    return NextResponse.json({ error: "code_required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Zet parent_started_at als de sessie bestaat en open is.
  const { data: session, error } = await admin
    .from("sessions")
    .update({ parent_started_at: new Date().toISOString() })
    .eq("helper_id", user.id)
    .eq("code", code)
    .eq("status", "open")
    .is("parent_started_at", null)
    .select("id, code, status, helper_id, requester_name, created_at, parent_started_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Als hij al gestart was, halen we de sessie alsnog op (idempotent gedrag).
  if (!session) {
    const { data: existing, error: readErr } = await admin
      .from("sessions")
      .select("id, code, status, helper_id, requester_name, created_at, parent_started_at")
      .eq("helper_id", user.id)
      .eq("code", code)
      .eq("status", "open")
      .maybeSingle();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 400 });
    }

    return NextResponse.json({ session: existing ?? null });
  }

  return NextResponse.json({ session });
}
