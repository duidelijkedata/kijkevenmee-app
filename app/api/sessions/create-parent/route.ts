import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const requester_name = typeof body?.requester_name === "string" ? body.requester_name : null;
  const requester_note = typeof body?.requester_note === "string" ? body.requester_note : null;

  const supabase = supabaseAdmin();
  const code = generateCode();

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      code,
      status: "open",
      requester_name,
      requester_note,
    })
    .select("id, code, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ session });
}
