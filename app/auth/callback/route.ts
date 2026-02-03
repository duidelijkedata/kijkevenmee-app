import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/kind";

  // Als Supabase een error terugstuurt, geef die door aan login (handig debuggen)
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  if (err) {
    return NextResponse.redirect(
      `${origin}/kind/login?error=${encodeURIComponent(errDesc || err)}`
    );
  }

  // Dit is precies jouw probleem nu: geen code = geen callback params
  if (!code) {
    return NextResponse.redirect(`${origin}/kind/login?error=missing_callback_params`);
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

  // ✅ Hier wordt de code omgezet naar een sessie + cookies gezet
  await supabase.auth.exchangeCodeForSession(code);

  // ✅ daarna door naar waar jij heen wil
  return NextResponse.redirect(`${origin}${next}`);
}
