import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Apoderado, Contacto, Estudiante } from "@/lib/types";
import { EditarApoderadoForm } from "./editar-form";

export const metadata = { title: "Editar familia — Tesorería CPCC" };

export default async function EditarApoderadoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const [{ data: apoderado }, { data: contactos }, { data: estudiantes }] =
    await Promise.all([
      supabase.from("apoderados").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("contactos")
        .select("*")
        .eq("apoderado_id", id)
        .order("relacion"),
      supabase
        .from("estudiantes")
        .select("*")
        .eq("apoderado_id", id)
        .order("nombre"),
    ]);

  if (!apoderado) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Editar familia</h1>
      <div className="card">
        <EditarApoderadoForm
          apoderado={apoderado as Apoderado}
          contactos={(contactos as Contacto[] | null) ?? []}
          estudiantes={(estudiantes as Estudiante[] | null) ?? []}
        />
      </div>
    </div>
  );
}
