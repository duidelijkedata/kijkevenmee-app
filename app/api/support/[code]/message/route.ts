import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const text = String(body?.body ?? "").trim();

  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "message_too_long" }, { status: 400 });

  const { data: session, error: sErr } = await supabase
    .from("support_sessions")
    .select("id, status")
    .eq("code", code)
    .single();

  if (sErr || !session || session.status !== "open") {
    return NextResponse.json({ error: "invalid session" }, { status: 404 });
  }

  const { error: mErr } = await supabase.from("support_messages").insert({
    session_id: session.id,
    sender: "parent",
    body: text,
  });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
