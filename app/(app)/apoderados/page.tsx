import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatFecha } from "@/lib/formatters";
import { ApoderadosSearch } from "./apoderados-search";
import { ApoderadoRow } from "./apoderado-row";
import type { Apoderado } from "@/lib/types";

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
  let query = supabase
    .from("apoderados")
    .select("*")
    .order("nombre", { ascending: true })
    .limit(500);
  if (q) query = query.ilike("nombre", `%${q}%`);
  if (curso) query = query.eq("curso", curso);
  const { data: apoderados } = await query;

  const { data: cursosRaw } = await supabase
    .from("apoderados")
    .select("curso")
    .not("curso", "is", null);
  const cursos = Array.from(
    new Set((cursosRaw ?? []).map((c) => c.curso).filter(Boolean) as string[])
  ).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Apoderados</h1>
          <p className="text-sm text-slate-600">
            {apoderados?.length ?? 0} apoderado(s) mostrados
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

      {!apoderados || apoderados.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay apoderados que coincidan.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Nombre</th>
                <th className="table-th">Estudiante</th>
                <th className="table-th">Curso</th>
                <th className="table-th">Email</th>
                <th className="table-th">Teléfono</th>
                <th className="table-th">Alta</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(apoderados as Apoderado[]).map((a) => (
                <ApoderadoRow
                  key={a.id}
                  a={a}
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
