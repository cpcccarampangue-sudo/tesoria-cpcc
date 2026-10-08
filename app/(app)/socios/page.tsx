import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { precioVigente } from "@/lib/socios/precio";
import {
  SOCIO_ESTADO_LABEL,
  type SocioConfig,
  type SocioEstado,
  type SocioSolicitud,
} from "@/lib/types";

export const metadata = { title: "Socios — Tesorería CPCC" };
export const dynamic = "force-dynamic";

const ESTADOS_FILTRO: Array<{ value: string; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "pendiente_match", label: "Pendientes de identificar" },
  { value: "pendiente_pago", label: "Pendientes de pago" },
  { value: "pagada", label: "Pagadas (sin QR enviado)" },
  { value: "enviada", label: "Con QR enviado" },
  { value: "rechazada", label: "Rechazadas" },
  { value: "anulada", label: "Anuladas" },
];

const ESTADO_BADGE: Record<SocioEstado, string> = {
  pendiente_match: "badge-amber",
  pendiente_pago: "badge-amber",
  pagada: "badge-blue",
  enviada: "badge-green",
  rechazada: "badge-red",
  anulada: "badge-slate",
};

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function SociosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string }>;
}) {
  await requireDirectiva();
  const sp = await searchParams;
  const estado = firstParam(sp.estado) || "todas";
  const q = firstParam(sp.q).trim();

  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("socio_solicitudes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (estado !== "todas") {
    query = query.eq("estado", estado);
  }
  if (q) {
    // Buscar en nombre apoderado, email o alumno
    const like = `%${q}%`;
    query = query.or(
      `apoderado_nombre.ilike.${like},apoderado_email.ilike.${like},alumno_nombre.ilike.${like}`
    );
  }

  const [{ data: solsData }, { data: cfgData }] = await Promise.all([
    query,
    supabase.from("socio_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  const solicitudes = (solsData as SocioSolicitud[] | null) ?? [];
  const config = cfgData as SocioConfig | null;

  // Resumen
  const resumen = solicitudes.reduce(
    (acc, s) => {
      acc[s.estado] = (acc[s.estado] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Socios del CdP</h1>
          <p className="text-sm text-slate-600">
            Solicitudes de incorporación recibidas desde el formulario público{" "}
            <Link href="/incorporacion" className="text-brand-700 underline">
              /incorporacion
            </Link>
            .
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/socios/nuevo" className="btn-primary text-sm">
            💵 Nuevo socio (pago manual)
          </Link>
          <Link href="/socios/config" className="btn-secondary text-sm">
            ⚙️ Configuración
          </Link>
          <Link
            href="/incorporacion"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm"
          >
            Ver formulario público ↗
          </Link>
        </div>
      </div>

      {/* Resumen rapido del periodo vigente */}
      {config && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Período activo: {config.periodo_anio}
              </h2>
              <p className="text-xs text-slate-500">
                Validez:{" "}
                {config.periodo_inicio && config.periodo_fin ? (
                  <strong>
                    {config.periodo_inicio} → {config.periodo_fin}
                  </strong>
                ) : (
                  <span className="text-amber-700 font-medium">
                    sin fechas configuradas
                  </span>
                )}{" "}
                · Monto cuota:{" "}
                <strong>
                  ${precioVigente(config).toLocaleString("es-CL")} CLP
                </strong>{" "}
                · Link SumUp:{" "}
                {config.sumup_link ? (
                  <a
                    href={config.sumup_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700 underline"
                  >
                    configurado
                  </a>
                ) : (
                  <span className="text-amber-700 font-medium">
                    no configurado
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <form className="card flex flex-wrap items-end gap-3" method="GET">
        <div>
          <label className="label">Estado</label>
          <select name="estado" defaultValue={estado} className="input">
            {ESTADOS_FILTRO.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="label">Buscar</label>
          <input
            name="q"
            defaultValue={q}
            className="input"
            placeholder="Nombre, correo, alumno..."
          />
        </div>
        <button className="btn-primary">Filtrar</button>
      </form>

      {/* Tabla */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Apoderado</th>
              <th className="table-th">Alumno · Curso</th>
              <th className="table-th">Período</th>
              <th className="table-th">Estado</th>
              <th className="table-th">Fecha</th>
              <th className="table-th text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {solicitudes.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No hay solicitudes que coincidan con el filtro.
                </td>
              </tr>
            ) : (
              solicitudes.map((s) => (
                <tr key={s.id}>
                  <td className="table-td">
                    <div className="font-medium">{s.apoderado_nombre}</div>
                    <div className="text-xs text-slate-500">
                      {s.apoderado_email}
                    </div>
                  </td>
                  <td className="table-td">
                    <div>{s.alumno_nombre}</div>
                    <div className="text-xs text-slate-500">{s.curso}</div>
                  </td>
                  <td className="table-td">{s.periodo_anio}</td>
                  <td className="table-td">
                    <span className={`${ESTADO_BADGE[s.estado]} text-xs`}>
                      {SOCIO_ESTADO_LABEL[s.estado]}
                    </span>
                  </td>
                  <td className="table-td text-xs text-slate-600">
                    {new Date(s.created_at).toLocaleDateString("es-CL")}
                  </td>
                  <td className="table-td text-right">
                    <Link
                      href={`/socios/${s.id}`}
                      className="text-brand-700 hover:underline text-xs"
                    >
                      Ver detalle →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Resumen por estado abajo */}
      {solicitudes.length > 0 && (
        <div className="text-xs text-slate-500">
          Mostrando {solicitudes.length} solicitud(es){" "}
          {estado !== "todas" ? `con estado "${estado}"` : "en total"}.
          {Object.entries(resumen).length > 1 && (
            <>
              {" "}
              Desglose:{" "}
              {Object.entries(resumen)
                .map(
                  ([e, n]) =>
                    `${SOCIO_ESTADO_LABEL[e as SocioEstado]}: ${n}`
                )
                .join(" · ")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
