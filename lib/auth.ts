import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { CONV_COOKIE, obtenerSesionOperador, type SesionOperadorInfo } from "./operador/sesion";
import type { UserRole } from "./types";

export type SessionProfile = {
  id: string;
  email: string;
  nombre: string | null;
  role: UserRole;
  apoderado_id: string | null;
  curso_asignado: string | null;
  first_login: boolean;
};

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, nombre, role, apoderado_id, curso_asignado, first_login")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  return profile as SessionProfile;
}

export async function requireProfile(): Promise<SessionProfile> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    redirect(
      `/login?debug=${encodeURIComponent("no-user:" + (userErr?.message ?? "sin usuario"))}`
    );
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, email, nombre, role, apoderado_id, curso_asignado, first_login")
    .eq("id", user.id)
    .single();

  if (profErr || !profile) {
    redirect(
      `/login?debug=${encodeURIComponent(
        "no-profile:" +
          (profErr?.message ?? "sin perfil") +
          " (user.id=" +
          user.id +
          ")"
      )}`
    );
  }
  return profile as SessionProfile;
}

export async function requireDirectiva(): Promise<SessionProfile> {
  const profile = await requireProfile();
  if (profile.role !== "directiva") redirect("/dashboard");
  return profile;
}

export function isDirectiva(profile: SessionProfile | null): boolean {
  return profile?.role === "directiva";
}

// Contexto del actor autorizado a usar /validar: directiva (sesion
// Supabase normal) u operador de convenio (cookie conv_session).
export type ValidadorContexto =
  | { tipo: "directiva"; profile: SessionProfile }
  | { tipo: "operador"; sesion: SesionOperadorInfo };

// Devuelve el contexto si hay autorizacion vigente, null si no.
// NO redirige. Util para páginas que quieren decidir que mostrar.
export async function getValidadorContexto(): Promise<ValidadorContexto | null> {
  // 1) Directiva (sesion Supabase + rol).
  const profile = await getSessionProfile();
  if (profile?.role === "directiva") {
    return { tipo: "directiva", profile };
  }
  // 2) Operador (cookie conv_session + sesion activa + operador y
  //    convenio activos). obtenerSesionOperador ya hace las verificaciones.
  const c = await cookies();
  const token = c.get(CONV_COOKIE)?.value ?? null;
  const sesion = await obtenerSesionOperador(token);
  if (sesion) return { tipo: "operador", sesion };
  return null;
}

// Como requireDirectiva pero acepta tambien operador autorizado. Si no
// hay ningun contexto valido, redirige a /validar/acceso (flujo publico
// de login operador). Nunca degrada la seguridad existente: directiva
// sigue pasando igual que con requireDirectiva.
export async function requireValidador(): Promise<ValidadorContexto> {
  const ctx = await getValidadorContexto();
  if (ctx) return ctx;
  redirect("/validar/acceso");
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "directiva":
      return "Directiva";
    case "delegado":
      return "Delegado";
    case "apoderado":
      return "Apoderado";
  }
}
