import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatFecha } from "@/lib/formatters";
import { ApoderadosSearch } from "./apoderados-search";
import { ApoderadoRow } from "./apoderado-row";
import type { Apoderado, Estudiante } from "@/lib/types";

export const metadata = { title: "Apoderados — Tesorería CPCC" };

export default async function ApoderadosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; curso?: string }>;
}) {
  await requireDirectiva();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const curso = (params.curso ?? "").trim();

  const supabase = await createSupabaseServerClient();

  // Traer apoderados con sus estudiantes
  let query = supabase
    .from("apoderados")
    .select("*, estudiantes(*)")
    .order("nombre", { ascending: true })
    .limit(500);
  if (q) query = query.ilike("nombre", `%${q}%`);
  const { data: raw } = await query;

  type Row = Apoderado & { estudiantes: Estudiante[] };
  let apoderados = (raw as Row[] | null) ?? [];

  // Filtro por curso: en cliente (RLS ya trajo todo)
  if (curso) {
    apoderados = apoderados.filter((a) =>
      (a.estudiantes ?? []).some((e) => e.curso === curso)
    );
  }

  // Todos los cursos posibles para el <select>
  const { data: cursosRaw } = await supabase
    .from("estudiantes")
    .select("curso")
    .not("curso", "is", null)
    .eq("activo", true);
  const cursos = Array.from(
    new Set((cursosRaw ?? []).map((c) => c.curso).filter(Boolean) as string[])
  ).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Apoderados</h1>
          <p className="text-sm text-slate-600">
            {apoderados.length} apoderado(s) mostrados
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/apoderados/nuevo" className="btn-secondary">
            + Nuevo
          </Link>
          <Link href="/apoderados/importar" className="btn-primary">
            Importar CSV
          </Link>
        </div>
      </div>

      <div className="card">
        <ApoderadosSearch initialQ={q} initialCurso={curso} cursos={cursos} />
      </div>

      {apoderados.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay apoderados que coincidan.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Nombre</th>
                <th className="table-th">Hijos</th>
                <th className="table-th">Email</th>
                <th className="table-th">Teléfono</th>
                <th className="table-th">Alta</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {apoderados.map((a) => (
                <ApoderadoRow
                  key={a.id}
                  a={a}
                  estudiantes={a.estudiantes ?? []}
                  altaLabel={formatFecha(a.created_at)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
