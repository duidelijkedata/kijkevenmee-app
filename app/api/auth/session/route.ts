import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const helper_id = String(body?.helper_id || "").trim();

  if (!helper_id) {
    return NextResponse.json({ error: "helper_id required" }, { status: 400 });
  }

  // Require logged-in requester
  const supabase = await supabaseServer();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user ?? null;

  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Must be linked: requester is child_id, target is helper_id
  const { data: rel, error: relErr } = await supabase
    .from("helper_relationships")
    .select("id")
    .eq("child_id", user.id)
    .eq("helper_id", helper_id)
    .maybeSingle();

  if (relErr) return NextResponse.json({ error: relErr.message }, { status: 400 });
  if (!rel) return NextResponse.json({ error: "not_linked" }, { status: 403 });

  // Create a session assigned to this helper
  const admin = supabaseAdmin();
  const code = generateCode();

  const { data: session, error } = await admin
    .from("sessions")
    .insert({
      code,
      status: "open",
      helper_id,
    })
    .select("id, code, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ session });
}
