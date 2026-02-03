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

    if (!user) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body?.ids) ? body.ids : [];
    const wanted = uniq(requested).slice(0, 50);

    if (wanted.length === 0) {
      return NextResponse.json({ profiles: {} });
    }

    // 1) Bepaal welke ids "related" zijn (gekoppeld) met de huidige user.
    //    We staan toe: user is child_id OF helper_id.
    const { data: rels, error: relErr } = await supabase
      .from("helper_relationships")
      .select("child_id, helper_id")
      .or(`child_id.eq.${user.id},helper_id.eq.${user.id}`);

    if (relErr) {
      return NextResponse.json({ error: relErr.message }, { status: 500 });
    }

    const related = new Set<string>();
    for (const r of rels ?? []) {
      const childId = (r as any).child_id as string | null;
      const helperId = (r as any).helper_id as string | null;

      if (childId && childId !== user.id) related.add(childId);
      if (helperId && helperId !== user.id) related.add(helperId);
    }

    // 2) Intersect requested ids met related ids
    const allowedIds = wanted.filter((id) => related.has(id));

    if (allowedIds.length === 0) {
      return NextResponse.json({ profiles: {} });
    }

    // 3) Fetch profiles via service role (bypasst RLS), maar alleen voor allowed ids
    const admin = supabaseAdmin();
    const { data: profs, error: profErr } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", allowedIds);

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    const map: Record<string, string | null> = {};
    for (const p of profs ?? []) {
      map[(p as any).id] = (p as any).display_name ?? null;
    }

    return NextResponse.json({ profiles: map });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown_error" }, { status: 500 });
  }
}
