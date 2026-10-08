import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SocioConfig } from "@/lib/types";
import { ConfigForm } from "./config-form";

export const metadata = { title: "Configuración de socios — Tesorería CPCC" };
export const dynamic = "force-dynamic";

type CuentaOp = { id: string; nombre: string; es_principal: boolean };
type CategoriaOp = { id: string; nombre: string };

export default async function SocioConfigPage() {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: cuentasData }, { data: categoriasData }] =
    await Promise.all([
      supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("cuentas")
        .select("id, nombre, es_principal")
        .eq("activa", true)
        .order("orden")
        .order("nombre"),
      supabase
        .from("categorias")
        .select("id, nombre")
        .eq("activa", true)
        .eq("tipo", "ingreso")
        .order("nombre"),
    ]);

  const config = (data as SocioConfig | null) ?? {
    id: 1,
    periodo_anio: new Date().getFullYear(),
    periodo_inicio: null,
    periodo_fin: null,
    monto_cuota: 20000,
    monto_cuota_normal: 20000,
    monto_cuota_promocional: null,
    promocion_inicio: null,
    promocion_fin: null,
    sumup_link: null,
    sumup_link_promo: null,
    sumup_link_normal: null,
    sumup_checkout_fijo: false,
    cuenta_sumup_id: null,
    categoria_cuota_id: null,
    mensaje_bienvenida: null,
    updated_at: new Date().toISOString(),
  };
  const cuentas = (cuentasData as CuentaOp[] | null) ?? [];
  const categorias = (categoriasData as CategoriaOp[] | null) ?? [];

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <Link
          href="/socios"
          className="text-sm text-slate-600 hover:underline"
        >
          ← Volver a socios
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Configuración del módulo</h1>
        <p className="text-sm text-slate-600 mt-1">
          Edita el año activo, el monto de la cuota, el link de pago SumUp y
          el mensaje que ven los apoderados en el formulario público.
        </p>
      </div>
      <div className="card">
        <ConfigForm
          config={config}
          cuentas={cuentas}
          categorias={categorias}
        />
      </div>
    </div>
  );
}
