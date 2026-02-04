import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params;

  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("support_camera_tokens")
    .select("support_code, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: "token_not_found" }, { status: 404 });
  }

  if (data.expires_at && Date.now() > new Date(data.expires_at).getTime()) {
    return NextResponse.json({ error: "token_expired" }, { status: 410 });
  }

  return NextResponse.json({ code: data.support_code });
}
