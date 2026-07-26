import { createClient } from "@supabase/supabase-js";

// Cliente con service role — solo usar en server actions puntuales (importar apoderados).
// NUNCA importar desde código cliente.
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
