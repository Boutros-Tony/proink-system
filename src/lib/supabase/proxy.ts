import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => supabaseResponse.headers.set(name, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";

  if (!signedIn && !isLogin) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    copyCookies(supabaseResponse, redirect);
    return redirect;
  }
  if (signedIn && isLogin && !request.nextUrl.searchParams.has("error")) {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    copyCookies(supabaseResponse, redirect);
    return redirect;
  }
  return supabaseResponse;
}

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(name);
    if (value) to.headers.set(name, value);
  }
}
