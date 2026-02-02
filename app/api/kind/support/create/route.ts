import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function POST() {
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const code = generateCode();

  const { error } = await supabase.from("support_sessions").insert({
    code,
    owner_user_id: userData.user.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ code });
}
