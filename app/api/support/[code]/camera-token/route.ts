import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function randomToken(len = 28) {
  // URL-safe-ish token
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const dynamic = "force-dynamic";

export async function POST(req: Request, props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;

  // Auth check via user session cookies
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Admin client voor DB writes (om RLS-issues te voorkomen in server route)
  const admin = supabaseAdmin();

  // 1) Support session ophalen, of aanmaken als hij nog niet bestaat
  const { data: existing, error: existErr } = await admin
    .from("support_sessions")
    .select("code, owner_user_id")
    .eq("code", code)
    .maybeSingle();

  if (existErr) {
    return NextResponse.json({ error: existErr.message }, { status: 500 });
  }

  if (!existing) {
    // maak sessie aan + claim ownership
    const { error: insSessErr } = await admin.from("support_sessions").insert({
      code,
      owner_user_id: user.id,
    });

    if (insSessErr) {
      return NextResponse.json({ error: insSessErr.message }, { status: 500 });
    }
  } else {
    // bestaat wél → ownership check (of claim als leeg)
    if (existing.owner_user_id && existing.owner_user_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (!existing.owner_user_id) {
      const { error: claimErr } = await admin
        .from("support_sessions")
        .update({ owner_user_id: user.id })
        .eq("code", code);

      if (claimErr) {
        return NextResponse.json({ error: claimErr.message }, { status: 500 });
      }
    }
  }

  // 2) Oude tokens opruimen voor deze sessie (optioneel)
  await admin.from("support_camera_tokens").delete().eq("support_code", code);

  // 3) Nieuw token maken
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  const { error: insErr } = await admin.from("support_camera_tokens").insert({
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
