import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function generateCode() {
  // 6 digits
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const requester_name = typeof body?.requester_name === "string" ? body.requester_name : null;
  const requester_note = typeof body?.requester_note === "string" ? body.requester_note : null;

  // ✅ Nieuw: optional helper_id
  // Als dit meegegeven wordt, is de sessie "toegewezen" en kan Kind hem zien bij actieve sessies.
  const helper_id = typeof body?.helper_id === "string" ? body.helper_id.trim() : null;

  const supabase = supabaseAdmin();
  const code = generateCode();

  const insertPayload: Record<string, any> = {
    code,
    status: "open",
    requester_name,
    requester_note,
  };

  // ✅ Alleen zetten als meegegeven
  if (helper_id) insertPayload.helper_id = helper_id;

  const { data: session, error } = await supabase
    .from("sessions")
    .insert(insertPayload)
    .select("id, code, status, helper_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ session });
}
