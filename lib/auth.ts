import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import type { UserRole } from "./types";

export type SessionProfile = {
  id: string;
  email: string;
  nombre: string | null;
  role: UserRole;
  apoderado_id: string | null;
};

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, nombre, role, apoderado_id")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  return profile as SessionProfile;
}

export async function requireProfile(): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireDirectiva(): Promise<SessionProfile> {
  const profile = await requireProfile();
  if (profile.role !== "directiva") redirect("/dashboard");
  return profile;
}

export function isDirectiva(profile: SessionProfile | null): boolean {
  return profile?.role === "directiva";
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
