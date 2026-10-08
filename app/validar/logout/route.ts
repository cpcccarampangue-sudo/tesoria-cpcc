// Cierre de sesion del operador de convenio. Revoca la sesion en DB y
// borra la cookie conv_session. Si el request viene de alguien sin
// cookie o si es directiva, igual redirige a /validar/acceso (nunca falla).

import { NextResponse } from "next/server";
import { cerrarSesionOperador } from "@/app/validar/acceso/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await cerrarSesionOperador();
  } catch {
    // best-effort
  }
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/validar/acceso`, { status: 303 });
}
