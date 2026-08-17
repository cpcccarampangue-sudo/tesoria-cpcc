import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TransferenciaForm } from "./transferencia-form";

export const metadata = {
  title: "Nueva transferencia — Tesorería CPCC",
};

export default async function NuevaTransferenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ origen_id?: string; destino_id?: string }>;
}) {
  await requireDirectiva();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: cuentas } = await supabase
    .from("cuentas")
    .select("id, nombre, color, es_principal, activa")
    .eq("activa", true)
    .order("orden")
    .order("nombre");

  const cuentasActivas = cuentas ?? [];
  const principal = cuentasActivas.find((c) => c.es_principal);
  const initialOrigen =
    params.origen_id ?? principal?.id ?? cuentasActivas[0]?.id ?? "";
  const initialDestino =
    params.destino_id ??
    cuentasActivas.find((c) => c.id !== initialOrigen)?.id ??
    "";

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Nueva transferencia entre cuentas</h1>
      <p className="text-sm text-slate-600">
        Mueve plata de una cuenta del CdP a otra. No afecta el balance total —
        solo cambia dónde está la plata. Se registran dos líneas linkeadas:
        egreso en la cuenta origen e ingreso en la cuenta destino.
      </p>
      <div className="card">
        <TransferenciaForm
          cuentas={cuentasActivas}
          initialOrigenId={initialOrigen}
          initialDestinoId={initialDestino}
        />
      </div>
    </div>
  );
}
