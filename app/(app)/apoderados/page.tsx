import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatFecha } from "@/lib/formatters";
import { ApoderadosSearch } from "./apoderados-search";
import { ApoderadoRow } from "./apoderado-row";
import type { Apoderado, Contacto, Estudiante } from "@/lib/types";

export const metadata = { title: "Familias — Tesorería CPCC" };

export default async function ApoderadosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; curso?: string; socio?: string }>;
}) {
  await requireDirectiva();
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const curso = (params.curso ?? "").trim();
  const socio = (params.socio ?? "").trim(); // "si", "no", ""

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("apoderados")
    .select("*, contactos(*), estudiantes(*)")
    .order("nombre", { ascending: true })
    .limit(1000);
  if (q) query = query.ilike("nombre", `%${q}%`);
  if (socio === "si") query = query.eq("socio", true);
  if (socio === "no") query = query.eq("socio", false);
  const { data: raw } = await query;

  type Row = Apoderado & { contactos: Contacto[]; estudiantes: Estudiante[] };
  let apoderados = (raw as Row[] | null) ?? [];

  if (curso) {
    apoderados = apoderados.filter((a) =>
      (a.estudiantes ?? []).some((e) => e.curso === curso)
    );
  }

  const { data: cursosRaw } = await supabase
    .from("estudiantes")
    .select("curso")
    .not("curso", "is", null)
    .eq("activo", true);
  const cursos = Array.from(
    new Set((cursosRaw ?? []).map((c) => c.curso).filter(Boolean) as string[])
  ).sort();

  const totalSocios = apoderados.filter((a) => a.socio).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Familias</h1>
          <p className="text-sm text-slate-600">
            {apoderados.length} familia(s) mostradas · {totalSocios} socias
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/apoderados/nuevo" className="btn-secondary">
            + Nueva familia
          </Link>
          <Link href="/apoderados/importar" className="btn-secondary">
            Importar CSV
          </Link>
          <Link href="/apoderados/importar-excel" className="btn-secondary">
            Importar Excel
          </Link>
          <Link href="/apoderados/sincronizar" className="btn-primary">
            🔄 Sincronizar Google Sheets
          </Link>
        </div>
      </div>

      <div className="card">
        <ApoderadosSearch
          initialQ={q}
          initialCurso={curso}
          initialSocio={socio}
          cursos={cursos}
        />
      </div>

      {apoderados.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No hay familias que coincidan.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">Familia</th>
                <th className="table-th">Socio</th>
                <th className="table-th">Contactos</th>
                <th className="table-th">Hijos</th>
                <th className="table-th">Alta</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {apoderados.map((a) => (
                <ApoderadoRow
                  key={a.id}
                  a={a}
                  contactos={a.contactos ?? []}
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
