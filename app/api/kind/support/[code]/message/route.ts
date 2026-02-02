import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const text = String(body?.body ?? "").trim();

  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "message_too_long" }, { status: 400 });

  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: session, error: sErr } = await supabase
    .from("support_sessions")
    .select("id, owner_user_id, status")
    .eq("code", code)
    .single();

  if (sErr || !session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (session.owner_user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (session.status !== "open") return NextResponse.json({ error: "closed" }, { status: 400 });

  const { error: mErr } = await supabase.from("support_messages").insert({
    session_id: session.id,
    sender: "child",
    body: text,
  });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
