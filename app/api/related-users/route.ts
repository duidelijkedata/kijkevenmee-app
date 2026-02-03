import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function uniq(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body?.ids) ? body.ids : [];
    const wanted = uniq(requested).slice(0, 100);

    if (wanted.length === 0) return NextResponse.json({ users: [] });

    // bepaal "related" ids via helper_relationships
    const { data: rels, error: relErr } = await supabase
      .from("helper_relationships")
      .select("child_id, helper_id")
      .or(`child_id.eq.${user.id},helper_id.eq.${user.id}`);

    if (relErr) return NextResponse.json({ error: relErr.message }, { status: 500 });

    const related = new Set<string>();
    for (const r of rels ?? []) {
      const childId = (r as any).child_id as string | null;
      const helperId = (r as any).helper_id as string | null;
      if (childId && childId !== user.id) related.add(childId);
      if (helperId && helperId !== user.id) related.add(helperId);
    }

    const allowed = wanted.filter((id) => related.has(id));
    if (allowed.length === 0) return NextResponse.json({ users: [] });

    const admin = supabaseAdmin();
    const { data: profs, error: profErr } = await admin
      .from("profiles")
      .select("id, display_name, last_seen_at, use_koppelcode")
      .in("id", allowed);

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    const users = (profs ?? []).map((p: any) => ({
      id: p.id,
      display_name: p.display_name ?? null,
      last_seen_at: p.last_seen_at ?? null,
      use_koppelcode: p.use_koppelcode ?? null,
    }));

    return NextResponse.json({ users });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}
