import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

type CookiesToSet = Array<{
  name: string;
  value: string;
  options?: any;
}>;

type SessionPayload =
  | { code: string }
  | { access_token: string; refresh_token: string }
  | { token_hash: string; type: string };

export async function POST(req: Request) {
  const cookieStore = cookies();
  const res = NextResponse.json({ ok: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" },
      { status: 500 }
    );
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  let body: SessionPayload | any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ✅ PKCE: magic link komt terug met ?code=... (meest voorkomend)
  if (body?.code && typeof body.code === "string") {
    const { error } = await supabase.auth.exchangeCodeForSession(body.code);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return res;
  }

  // ✅ Implicit: tokens in hash (legacy / sommige flows)
  if (
    body?.access_token &&
    body?.refresh_token &&
    typeof body.access_token === "string" &&
    typeof body.refresh_token === "string"
  ) {
    const { error } = await supabase.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return res;
  }

  // ✅ OTP verify via token_hash/type (optioneel)
  if (
    body?.token_hash &&
    body?.type &&
    typeof body.token_hash === "string" &&
    typeof body.type === "string"
  ) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: body.token_hash,
      // Supabase verwacht een specifieke string-union; we laten TS niet moeilijk doen:
      type: body.type as any,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return res;
  }

  return NextResponse.json({ error: "Missing payload" }, { status: 400 });
}
