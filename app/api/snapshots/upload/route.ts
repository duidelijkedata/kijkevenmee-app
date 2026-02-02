import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const form = await req.formData();
  const code = String(form.get("code") || "");
  const caption = String(form.get("caption") || "");
  const file = form.get("file") as File | null;

  if (!code || !file) {
    return NextResponse.json({ error: "code and file required" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  const { data: session, error: sErr } = await supabase
    .from("sessions")
    .select("id, helper_id")
    .eq("code", code)
    .maybeSingle();

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (!session.helper_id) {
    // In V1: if parent created session, helper_id may be null.
    // We'll store under a "unassigned" folder and later attach when helper claims session.
    // For now: return a helpful error.
    return NextResponse.json({ error: "Nog geen kind gekoppeld aan deze code. Laat je kind eerst verbinden." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = `${session.helper_id}/${session.id}/${crypto.randomUUID()}.png`;

  const { error: upErr } = await supabase.storage
    .from("snapshots")
    .upload(path, bytes, { contentType: "image/png", upsert: false });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error: mErr } = await supabase.from("snapshots").insert({
    session_id: session.id,
    helper_id: session.helper_id,
    storage_path: path,
    caption: caption || null,
  });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
