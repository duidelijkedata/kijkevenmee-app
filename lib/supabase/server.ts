import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: any };

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          // In Server Components kan het zetten van cookies soms niet (read-only context).
          // Dat is oké: de API route hieronder zet cookies op de response.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // noop
          }
        },
      },
    }
  );
}
