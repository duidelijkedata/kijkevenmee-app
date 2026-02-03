import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // ✅ Laat Supabase callback altijd door (geen auth-redirect voordat exchange draait)
  if (pathname.startsWith("/auth/callback")) {
    return NextResponse.next();
  }

  // TODO: jouw bestaande middleware logic hieronder
  // Bijvoorbeeld:
  // return NextResponse.next();

  return NextResponse.next();
}

// ✅ Pas matcher aan op jouw situatie (voorbeeld)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
