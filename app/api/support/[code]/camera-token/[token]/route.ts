import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;

  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("support_camera_tokens")
    .select("support_code, expires_at")
    .eq("token", token)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "invalid_token" }, { status: 404 });
  }

  const expires = new Date(data.expires_at).getTime();
  if (Number.isFinite(expires) && expires < Date.now()) {
    // token is verlopen
    return NextResponse.json({ error: "token_expired" }, { status: 410 });
  }

  return NextResponse.json({ code: data.support_code });
}
