import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("support_camera_tokens")
    .select("token, support_code, owner_user_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "token_not_found" }, { status: 404 });
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (!expiresAt || Date.now() > expiresAt) {
    try {
      await admin.from("support_camera_tokens").delete().eq("token", token);
    } catch {}
    return NextResponse.json({ error: "token_expired" }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    support_code: data.support_code,
    owner_user_id: data.owner_user_id,
    expires_at: data.expires_at,
  });
}
