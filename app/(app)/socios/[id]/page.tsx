import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SOCIO_ESTADO_LABEL,
  type SocioEstado,
  type SocioSolicitud,
} from "@/lib/types";
import { AccionesSolicitud } from "./acciones";
import { generarQrDataUrl, urlPublicaSocio } from "@/lib/qr";

type CuentaRow = { id: string; nombre: string; es_principal: boolean };

export const metadata = { title: "Solicitud de socio — Tesorería CPCC" };
export const dynamic = "force-dynamic";

const ESTADO_BADGE: Record<SocioEstado, string> = {
  pendiente_match: "badge-amber",
  pendiente_pago: "badge-amber",
  pagada: "badge-blue",
  enviada: "badge-green",
  rechazada: "badge-red",
  anulada: "badge-slate",
};

export default async function SolicitudDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("socio_solicitudes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const s = data as SocioSolicitud;

  // Cargar cuentas activas para el dialog de pago manual
  const { data: cuentasData } = await supabase
    .from("cuentas")
    .select("id, nombre, es_principal")
    .eq("activa", true)
    .order("orden")
    .order("nombre");
  const cuentas = (cuentasData as CuentaRow[] | null) ?? [];

  // URL publica del QR (lo que codifica el QR en si).
  const urlPublica = urlPublicaSocio(s.qr_token);

  // Generar QR como data URL si la solicitud esta en estado valido.
  const puedeVerQr =
    s.estado === "pagada" || s.estado === "enviada";
  const qrDataUrl = puedeVerQr
    ? await generarQrDataUrl(urlPublica, { size: 400 })
    : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link
          href="/socios"
          className="text-sm text-slate-600 hover:underline"
        >
          ← Volver a socios
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {s.apoderado_nombre}
          </h1>
          <p className="text-sm text-slate-600">
            Solicitud de socio {s.periodo_anio} ·{" "}
            <span className={`${ESTADO_BADGE[s.estado]} text-xs ml-1`}>
              {SOCIO_ESTADO_LABEL[s.estado]}
            </span>
          </p>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Datos</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase text-slate-500">
              Apoderado
            </dt>
            <dd className="font-medium">
              {s.apoderado_id ? (
                <Link
                  href={`/apoderados/${s.apoderado_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {s.apoderado_nombre} ↗
                </Link>
              ) : (
                <>
                  {s.apoderado_nombre}
                  <span className="ml-2 text-xs text-amber-700">
                    (sin link a familia)
                  </span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Correo</dt>
            <dd>{s.apoderado_email}</dd>
          </div>
          {s.apoderado_rut && (
            <div>
              <dt className="text-xs uppercase text-slate-500">RUT</dt>
              <dd className="font-mono">{s.apoderado_rut}</dd>
            </div>
          )}
          {s.apoderado_telefono && (
            <div>
              <dt className="text-xs uppercase text-slate-500">Teléfono</dt>
              <dd>{s.apoderado_telefono}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase text-slate-500">Alumno</dt>
            <dd>{s.alumno_nombre}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Curso</dt>
            <dd>{s.curso}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Monto cuota</dt>
            <dd className="font-semibold">
              ${s.monto_cuota.toLocaleString("es-CL")}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">Creada</dt>
            <dd>{new Date(s.created_at).toLocaleString("es-CL")}</dd>
          </div>
          {s.pagada_en && (
            <div>
              <dt className="text-xs uppercase text-slate-500">
                Fecha de pago
              </dt>
              <dd>{new Date(s.pagada_en).toLocaleString("es-CL")}</dd>
            </div>
          )}
          {s.email_enviado_en && (
            <div>
              <dt className="text-xs uppercase text-slate-500">
                QR enviado
              </dt>
              <dd>
                {new Date(s.email_enviado_en).toLocaleString("es-CL")}
                {s.email_reenvios > 0 && (
                  <span className="text-xs text-slate-500 ml-2">
                    ({s.email_reenvios} reenvío
                    {s.email_reenvios > 1 ? "s" : ""})
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Movimiento asociado */}
      {s.movimiento_id && (
        <div className="card">
          <h2 className="font-semibold mb-2">Movimiento asociado</h2>
          <p className="text-sm">
            Esta solicitud generó un movimiento tipo <strong>ingreso</strong>{" "}
            en el libro de caja.{" "}
            <Link
              href={`/movimientos/${s.movimiento_id}`}
              className="text-brand-700 underline"
            >
              Ver movimiento ↗
            </Link>
          </p>
        </div>
      )}

      {/* SumUp (si tiene datos de pago registrados) */}
      {(s.sumup_checkout_id || s.sumup_transaction_id) && (
        <div className="card">
          <h2 className="font-semibold mb-3">Pago vía SumUp</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {s.sumup_checkout_id && (
              <div>
                <dt className="text-xs uppercase text-slate-500">
                  Checkout ID
                </dt>
                <dd className="font-mono text-xs">{s.sumup_checkout_id}</dd>
              </div>
            )}
            {s.sumup_transaction_id && (
              <div>
                <dt className="text-xs uppercase text-slate-500">
                  Transaction ID
                </dt>
                <dd className="font-mono text-xs">
                  {s.sumup_transaction_id}
                </dd>
              </div>
            )}
            {s.sumup_transaction_code && (
              <div>
                <dt className="text-xs uppercase text-slate-500">
                  Código SumUp
                </dt>
                <dd className="font-mono text-xs">
                  {s.sumup_transaction_code}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* QR + URL publica */}
      <div className="card">
        <h2 className="font-semibold mb-2">Código QR del socio</h2>
        {qrDataUrl ? (
          <div className="flex flex-wrap gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Código QR del socio"
              className="w-48 h-48 bg-white p-2 border border-slate-200 rounded-md flex-shrink-0"
            />
            <div className="flex-1 min-w-[200px] space-y-2 text-xs">
              <p className="text-slate-600">
                Puedes compartir este QR o la URL pública con el apoderado
                mientras no esté configurado el envío por correo.
              </p>
              <div className="font-mono bg-slate-50 border border-slate-200 rounded-md p-2 break-all">
                {urlPublica}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={qrDataUrl}
                  download={`qr-socio-${s.apoderado_nombre.replace(/\s+/g, "-")}.png`}
                  className="btn-secondary text-xs"
                >
                  ⬇ Descargar QR
                </a>
                <Link
                  href={`/socio/${s.qr_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary text-xs"
                >
                  Ver página pública ↗
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm bg-amber-50 border border-amber-200 rounded-md p-3 text-amber-900">
            El QR aún no está disponible: la solicitud debe estar en estado{" "}
            <strong>pagada</strong> para generarlo. Registra el pago primero.
            <div className="font-mono text-xs mt-2 bg-slate-50 border border-slate-200 rounded-md p-2 break-all">
              URL que codificará el QR: {urlPublica}
            </div>
          </div>
        )}
      </div>

      {/* Notas internas */}
      {s.notas_internas && (
        <div className="card bg-slate-50 text-sm">
          <h2 className="font-semibold mb-2">Notas internas</h2>
          <p className="whitespace-pre-wrap">{s.notas_internas}</p>
        </div>
      )}

      {/* Acciones */}
      <div className="card">
        <h2 className="font-semibold mb-3">Acciones</h2>
        <AccionesSolicitud solicitud={s} cuentas={cuentas} />
      </div>
    </div>
  );
}
