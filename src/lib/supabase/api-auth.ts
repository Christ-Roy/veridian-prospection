import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Verify Supabase auth for API routes.
 * Returns the authenticated user or a 401 JSON response.
 *
 * Usage in route handlers:
 *   const auth = await requireAuth();
 *   if (auth.error) return auth.error;
 *   const user = auth.user;
 */
export async function requireAuth(): Promise<
  { user: { id: string; email: string }; error?: never } | { user?: never; error: NextResponse }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // No Supabase configured — allow (internal tool mode)
    return { user: { id: "internal", email: "internal@localhost" } };
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      set(_name: string, _value: string, _options: CookieOptions) {},
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      remove(_name: string, _options: CookieOptions) {},
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { user: { id: user.id, email: user.email ?? "" } };
}
