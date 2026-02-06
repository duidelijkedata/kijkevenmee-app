import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user ?? null;

  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rawCode = String(body?.code ?? "");
  const code = rawCode.replace(/\D/g, "");

  if (code.length !== 6) {
    return NextResponse.json({ error: "code_required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Probeer een nette naam van de ouder mee te geven (handig voor kind-indicator)
  const { data: prof } = await admin
    .from("profiles")
    .select("display_name, full_name, name")
    .eq("id", user.id)
    .maybeSingle();

  const parentName =
    String(prof?.display_name ?? prof?.full_name ?? prof?.name ?? "").trim() || null;

  const nowIso = new Date().toISOString();

  /**
   * ✅ Belangrijk:
   * sessions.helper_id is bij jullie de "ontvanger" (kind/helper account).
   * Dus we mogen hier NIET filteren op helper_id=user.id.
   * We starten de sessie op basis van code + status.
   */
  const { data: updated, error: upErr } = await admin
    .from("sessions")
    .update({
      parent_started_at: nowIso,
      ...(parentName ? { requester_name: parentName } : {}),
    })
    .eq("code", code)
    .eq("status", "open")
    .is("parent_started_at", null)
    .select("id, code, status, helper_id, requester_name, created_at, parent_started_at")
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  // Idempotent: als hij al gestart is, geef de bestaande sessie terug
  if (!updated) {
    const { data: existing, error: readErr } = await admin
      .from("sessions")
      .select("id, code, status, helper_id, requester_name, created_at, parent_started_at")
      .eq("code", code)
      .eq("status", "open")
      .maybeSingle();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 400 });
    }

    return NextResponse.json({ session: existing ?? null });
  }

  return NextResponse.json({ session: updated });
}
