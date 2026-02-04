import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

function randomToken(len = 28) {
  // URL-safe-ish token
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(req: Request, props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;

  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Check: bestaat support session en is deze van deze ouder?
  const { data: sess, error: sessErr } = await supabase
    .from("support_sessions")
    .select("code, owner_user_id")
    .eq("code", code)
    .single();

  if (sessErr || !sess) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if (sess.owner_user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Optioneel: opruimen van oude tokens voor deze sessie (mag, niet verplicht)
  try {
    await supabase.from("support_camera_tokens").delete().eq("support_code", code);
  } catch {}

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  const { error: insErr } = await supabase.from("support_camera_tokens").insert({
    token,
    support_code: code,
    owner_user_id: user.id,
    expires_at: expiresAt,
  });

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  return NextResponse.json({
    token,
    expires_at: expiresAt,
  });
}
