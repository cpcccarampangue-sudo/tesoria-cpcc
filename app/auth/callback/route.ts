import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Callback del magic link.
// Supabase puede redirigir con distintos parámetros según la config:
//   ?code=xxx           → flujo PKCE (exchangeCodeForSession)
//   ?token_hash=xxx&type=magiclink → flujo directo (verifyOtp)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/dashboard";

  const supabase = await createSupabaseServerClient();

  // Intento 1: flujo PKCE
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("pkce:" + error.message)}`,
        url.origin
      )
    );
  }

  // Intento 2: flujo directo con token_hash (no requiere cookie PKCE)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("otp:" + error.message)}`,
        url.origin
      )
    );
  }

  return NextResponse.redirect(
    new URL("/login?error=no_code", url.origin)
  );
}
