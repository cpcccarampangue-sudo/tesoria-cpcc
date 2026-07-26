import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Endpoint público usado por GitHub Actions cada 3 días para evitar
// que Supabase pause el proyecto por inactividad.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("categorias").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
