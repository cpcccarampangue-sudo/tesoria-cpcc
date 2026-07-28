import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatFecha } from "@/lib/formatters";
import type { UserRole } from "@/lib/types";
import { UsuarioRow } from "./usuario-row";

export const metadata = { title: "Usuarios — Tesorería CPCC" };

type ProfileRow = {
  id: string;
  email: string;
  nombre: string | null;
  role: UserRole;
  apoderado_id: string | null;
  curso_asignado: string | null;
  created_at: string;
  apoderado: { nombre: string } | null;
};

export default async function UsuariosPage() {
  const currentProfile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("profiles")
    .select(
      "id, email, nombre, role, apoderado_id, curso_asignado, created_at, apoderado:apoderado_id(nombre)"
    )
    .order("role")
    .order("email");

  const usuarios = (data as unknown as ProfileRow[] | null) ?? [];

  // Cursos disponibles para el dropdown de delegados
  const { data: cursosRaw } = await supabase
    .from("estudiantes")
    .select("curso")
    .not("curso", "is", null)
    .eq("activo", true);
  const cursos = Array.from(
    new Set((cursosRaw ?? []).map((c) => c.curso).filter(Boolean) as string[])
  ).sort();

  const conteos = {
    directiva: usuarios.filter((u) => u.role === "directiva").length,
    delegado: usuarios.filter((u) => u.role === "delegado").length,
    apoderado: usuarios.filter((u) => u.role === "apoderado").length,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios del sistema</h1>
        <p className="text-sm text-slate-600">
          {usuarios.length} usuario(s) registrado(s) — Directiva:{" "}
          <strong>{conteos.directiva}</strong> · Delegados:{" "}
          <strong>{conteos.delegado}</strong> · Apoderados:{" "}
          <strong>{conteos.apoderado}</strong>
        </p>
      </div>

      <div className="card bg-blue-50 border border-blue-200 text-sm text-blue-900 space-y-1">
        <div className="font-semibold">Cómo agregar a alguien nuevo:</div>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>
            La persona debe crear su cuenta en la app (pestaña &quot;Crear
            cuenta&quot;) con su correo y contraseña.
          </li>
          <li>
            Una vez creada, aparecerá en esta lista como &quot;Apoderado&quot;
            por defecto.
          </li>
          <li>
            Aquí puedes cambiarle el rol a <strong>Directiva</strong> (acceso
            total) o <strong>Delegado</strong> (ve solo apoderados de su
            curso).
          </li>
        </ol>
      </div>

      {usuarios.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay usuarios registrados aún.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Email</th>
                <th className="table-th">Familia vinculada</th>
                <th className="table-th">Rol</th>
                <th className="table-th">Curso asignado</th>
                <th className="table-th">Registrado</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usuarios.map((u) => (
                <UsuarioRow
                  key={u.id}
                  u={u}
                  cursos={cursos}
                  esYo={u.id === currentProfile.id}
                  altaLabel={formatFecha(u.created_at)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
