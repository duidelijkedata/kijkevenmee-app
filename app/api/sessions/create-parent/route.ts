import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function uniq(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  let requester_name = typeof body?.requester_name === "string" ? body.requester_name : null;
  const requester_note = typeof body?.requester_note === "string" ? body.requester_note : null;

  // Client mag helper_id meegeven (bijv. dropdown). Anders proberen we server-side auto-assign.
  let helper_id = typeof body?.helper_id === "string" ? body.helper_id.trim() : null;

  let auto_assigned = false;
  let assign_reason: string | null = null;

  // ✅ Als ouder ingelogd is en requester_name leeg is -> pak display_name uit profiel
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (user && (!requester_name || !String(requester_name).trim())) {
      const admin = supabaseAdmin();
      const { data: prof } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle<{ display_name: string | null }>();

      const dn = String(prof?.display_name ?? "").trim();
      if (dn) requester_name = dn;
    }

    // auto-assign blijft zoals eerder
    if (!helper_id) {
      if (user) {
        const { data: rels, error: relErr } = await supabase
          .from("helper_relationships")
          .select("child_id, helper_id")
          .or(`child_id.eq.${user.id},helper_id.eq.${user.id}`);

        if (!relErr) {
          const related = new Set<string>();
          for (const r of rels ?? []) {
            const childId = (r as any).child_id as string | null;
            const helperId = (r as any).helper_id as string | null;

            if (childId === user.id && helperId) related.add(helperId);
            if (helperId === user.id && childId) related.add(childId);
          }

          const ids = uniq(Array.from(related));
          if (ids.length) {
            const admin = supabaseAdmin();
            const { data: profs } = await admin
              .from("profiles")
              .select("id, use_koppelcode")
              .in("id", ids);

            const noCode = (profs ?? []).filter((p: any) => (p.use_koppelcode ?? true) === false);

            if (noCode.length === 1) {
              helper_id = String(noCode[0].id);
              auto_assigned = true;
              assign_reason = "single_no_code_child";
            } else if (noCode.length > 1) {
              assign_reason = "multiple_no_code_children";
            } else {
              assign_reason = "no_no_code_children";
            }
          } else {
            assign_reason = "no_relationships_found";
          }
        } else {
          assign_reason = "relationships_query_failed";
        }
      } else {
        assign_reason = "not_authenticated";
      }
    }
  } catch {
    assign_reason = assign_reason ?? "auto_assign_exception";
  }

  const admin = supabaseAdmin();
  const code = generateCode();

  // ✅ Ouder initieert sessie: markeer meteen als "gestart"
  const nowIso = new Date().toISOString();

  const insertPayload: Record<string, any> = {
    code,
    status: "open",
    requester_name,
    requester_note,
    parent_started_at: nowIso,
  };
  if (helper_id) insertPayload.helper_id = helper_id;

  const { data: session, error } = await admin
    .from("sessions")
    .insert(insertPayload)
    .select("id, code, status, helper_id, requester_name, parent_started_at, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // ✅ sluit oude open sessies voor dit kind (zodat kind alleen laatste ziet)
  if (session?.helper_id) {
    await admin
      .from("sessions")
      .update({ status: "closed" })
      .eq("helper_id", session.helper_id)
      .eq("status", "open")
      .neq("id", session.id);
  }

  // server bepaalt of code vereist is (default true)
  let requires_code = true;
  if (session?.helper_id) {
    const { data: prof } = await admin
      .from("profiles")
      .select("use_koppelcode")
      .eq("id", session.helper_id)
      .maybeSingle<{ use_koppelcode: boolean | null }>();

    requires_code = prof?.use_koppelcode ?? true;
  }

  return NextResponse.json({
    session,
    auto_assigned,
    assign_reason,
    requires_code,
  });
}
