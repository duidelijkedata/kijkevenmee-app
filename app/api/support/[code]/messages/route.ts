import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;

  const { data: session, error: sErr } = await supabase
    .from("support_sessions")
    .select("id, status")
    .eq("code", code)
    .single();

  if (sErr || !session || session.status !== "open") {
    return NextResponse.json({ error: "invalid session" }, { status: 404 });
  }

  const { data: messages, error: mErr } = await supabase
    .from("support_messages")
    .select("id, sender, body, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 400 });
  }

  return NextResponse.json({ session_id: session.id, messages: messages ?? [] });
}
