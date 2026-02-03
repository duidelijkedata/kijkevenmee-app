import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?confirm_error=${encodeURIComponent(errorDesc || error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?confirm_error=missing_code`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  // 1) code omzetten naar session (bevestigt ook signup)
  await supabase.auth.exchangeCodeForSession(code);

  // 2) direct weer uitloggen: user moet daarna username+password doen
  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}/login?confirmed=1`);
}
