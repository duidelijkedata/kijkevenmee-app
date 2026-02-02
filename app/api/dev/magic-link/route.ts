import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (process.env.NODE_ENV !== "development") {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = body?.email as string | undefined;
    const redirectTo = body?.redirectTo as string | undefined;

    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });
    if (!redirectTo) return NextResponse.json({ error: "Missing redirectTo" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url) return NextResponse.json({ error: "Missing env: NEXT_PUBLIC_SUPABASE_URL" }, { status: 400 });
    if (!serviceKey) return NextResponse.json({ error: "Missing env: SUPABASE_SERVICE_ROLE_KEY" }, { status: 400 });

    console.log("[dev magic-link] email:", email);
    console.log("[dev magic-link] redirectTo:", redirectTo);
    console.log("[dev magic-link] project url:", url);

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Zorg dat user bestaat (dev-only)
    const createRes = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });

    if (createRes.error) {
      const msg = (createRes.error.message || "").toLowerCase();
      const okToIgnore =
        msg.includes("already") || msg.includes("exists") || msg.includes("duplicate") || msg.includes("registered");

      if (!okToIgnore) {
        console.error("[dev magic-link] createUser error:", createRes.error);
        return NextResponse.json({ error: createRes.error.message }, { status: 400 });
      }

      console.log("[dev magic-link] createUser: user already exists (ignored)");
    } else {
      console.log("[dev magic-link] createUser: created user id:", createRes.data.user?.id);
    }

    // 2) Genereer magic link die jij direct opent (geen mail verstuurd)
    const linkRes = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });

    if (linkRes.error) {
      console.error("[dev magic-link] generateLink error:", linkRes.error);
      return NextResponse.json({ error: linkRes.error.message }, { status: 400 });
    }

    const action_link = linkRes.data?.properties?.action_link;
    if (!action_link) {
      console.error("[dev magic-link] No action_link returned:", linkRes.data);
      return NextResponse.json({ error: "No action_link returned" }, { status: 500 });
    }

    console.log("[dev magic-link] action_link OK");
    return NextResponse.json({
      action_link,
      user_id: createRes.data?.user?.id ?? null,
    });
  } catch (e: any) {
    console.error("[dev magic-link] unexpected error:", e);
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
