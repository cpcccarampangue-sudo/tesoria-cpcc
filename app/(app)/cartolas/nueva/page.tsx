import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BANCOS_SOPORTADOS } from "@/lib/cartolas";
import { SubirCartolaForm } from "./subir-form";

export const metadata = { title: "Subir cartola — Tesorería CPCC" };

export default async function NuevaCartolaPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: cuentas } = await supabase
    .from("cuentas")
    .select("id, nombre, color, es_principal, activa, banco")
    .eq("activa", true)
    .order("orden")
    .order("nombre");

  const cuentasSoportadas = (cuentas ?? []).filter(
    (c) => c.banco && (BANCOS_SOPORTADOS as string[]).includes(c.banco)
  );

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">Subir cartola bancaria</h1>
      <p className="text-sm text-slate-600">
        Baja la cartola en Excel desde tu banco (Banco Estado como
        &quot;Chequera Electrónica&quot;, Banco de Chile como cartola
        histórica), selecciona la cuenta correspondiente y sube el archivo.
        El sistema parsea las líneas automáticamente.
      </p>
      <div className="card">
        {cuentasSoportadas.length === 0 ? (
          <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3">
            No hay cuentas configuradas con un banco soportado. Anda a{" "}
            <a href="/cuentas" className="underline font-medium">
              /cuentas
            </a>{" "}
            y asegúrate de que la cuenta tenga banco &quot;Banco Estado&quot;
            o &quot;Banco de Chile&quot; asignado.
          </div>
        ) : (
          <SubirCartolaForm cuentas={cuentasSoportadas} />
        )}
      </div>
    </div>
  );
}
