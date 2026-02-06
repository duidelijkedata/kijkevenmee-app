import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await supabaseServer();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user ?? null;

  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // We gebruiken admin, want we willen altijd kunnen updaten
  const admin = supabaseAdmin();

  // Pak de nieuwste open sessie voor deze helper die nog niet gestart is
  const { data: latest, error: findErr } = await admin
    .from("sessions")
    .select("id, code, status, requester_name, parent_started_at, created_at")
    .eq("helper_id", user.id)
    .eq("status", "open")
    .is("parent_started_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 400 });
  }

  // Haal helper-naam op (voor UI bij het kind)
  const { data: prof } = await admin
    .from("profiles")
    .select("display_name, full_name, name")
    .eq("id", user.id)
    .maybeSingle();

  const helperName =
    String(prof?.display_name ?? prof?.full_name ?? prof?.name ?? "").trim() || "Ouder";

  // Als er geen open sessie is, dan maken we er één (ouder initieert altijd).
  // Dit maakt de flow ook robuuster.
  if (!latest) {
    // Genereer code (zelfde methode als bij create-linked)
    const code = String(Math.floor(100000 + Math.random() * 900000));

    const { data: created, error: createErr } = await admin
      .from("sessions")
      .insert({
        code,
        status: "open",
        helper_id: user.id,
        requester_name: helperName,
        parent_started_at: new Date().toISOString(),
      })
      .select("id, code, status, requester_name, parent_started_at, created_at")
      .single();

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    return NextResponse.json({ session: created });
  }

  // Anders: markeer die sessie als gestart
  const { data: started, error: upErr } = await admin
    .from("sessions")
    .update({
      parent_started_at: new Date().toISOString(),
      // requester_name vullen als leeg (handig voor kind-lampje)
      requester_name: latest.requester_name || helperName,
    })
    .eq("id", latest.id)
    .select("id, code, status, requester_name, parent_started_at, created_at")
    .single();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 400 });
  }

  return NextResponse.json({ session: started });
}
