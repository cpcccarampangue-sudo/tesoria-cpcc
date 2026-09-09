import { notFound } from "next/navigation";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatCLP,
  formatFecha,
  formatFechaLarga,
} from "@/lib/formatters";
import type {
  BalancePorEvento,
  Evento,
  Movimiento,
  MovimientoAdjunto,
} from "@/lib/types";
import { PrintToolbar } from "./print-toolbar";

export const dynamic = "force-dynamic";

const IMG_EXT = /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i;
const PDF_EXT = /\.pdf$/i;

type BoletaResuelta = {
  key: string;
  movimientoId: string;
  fecha: string;
  monto: number;
  descripcion: string | null;
  tipoMov: string;
  tipoAdj: string;
  nombre: string;
  url: string;
  esImagen: boolean;
  esPdf: boolean;
};

export default async function ImprimirEventoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: eventoData } = await supabase
    .from("eventos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const evento = (eventoData as Evento | null) ?? null;
  if (!evento) notFound();

  const { data: balancesData } = await supabase.rpc("api_balance_por_evento");
  const balances = (balancesData as BalancePorEvento[] | null) ?? [];
  const balance = balances.find((b) => b.id === id) ?? {
    id,
    nombre: evento.nombre,
    fecha: evento.fecha,
    cerrado: evento.cerrado,
    ingresos: 0,
    egresos: 0,
    neto: 0,
  };

  const { data: movsData } = await supabase
    .from("movimientos")
    .select("*")
    .eq("evento_id", id)
    .order("fecha", { ascending: true })
    .order("created_at", { ascending: true });
  const movimientos = (movsData as Movimiento[] | null) ?? [];

  // Adjuntos multiples de todos los movimientos del evento
  const movIds = movimientos.map((m) => m.id);
  let adjuntos: MovimientoAdjunto[] = [];
  if (movIds.length > 0) {
    const { data: adjData } = await supabase
      .from("movimiento_adjuntos")
      .select("*")
      .in("movimiento_id", movIds)
      .order("subido_en", { ascending: true });
    adjuntos = (adjData as MovimientoAdjunto[] | null) ?? [];
  }

  // Recolectar TODAS las boletas: legacy boleta_path + adjuntos multiples.
  // Resolvemos URLs firmadas en paralelo (1h de validez).
  type Bruto = {
    key: string;
    movimientoId: string;
    fecha: string;
    monto: number;
    descripcion: string | null;
    tipoMov: string;
    tipoAdj: string;
    nombre: string;
    path: string;
  };
  const brutos: Bruto[] = [];
  const movById = new Map(movimientos.map((m) => [m.id, m]));
  // Deduplicacion por storage_path: si la misma boleta esta como legacy y
  // como adjunto nuevo (o dos veces por transferencia interna), la mostramos
  // una sola vez. Preferimos siempre el adjunto nuevo (tiene mejor metadata).
  const pathsVistos = new Set<string>();
  for (const a of adjuntos) {
    if (pathsVistos.has(a.storage_path)) continue;
    const m = movById.get(a.movimiento_id);
    if (!m) continue;
    pathsVistos.add(a.storage_path);
    brutos.push({
      key: `adj-${a.id}`,
      movimientoId: m.id,
      fecha: m.fecha,
      monto: m.monto,
      descripcion: m.descripcion,
      tipoMov: m.tipo,
      tipoAdj: a.tipo,
      nombre: a.nombre_original ?? a.storage_path.split("/").pop() ?? "adjunto",
      path: a.storage_path,
    });
  }
  for (const m of movimientos) {
    if (!m.boleta_path) continue;
    if (pathsVistos.has(m.boleta_path)) continue;
    pathsVistos.add(m.boleta_path);
    brutos.push({
      key: `legacy-${m.id}`,
      movimientoId: m.id,
      fecha: m.fecha,
      monto: m.monto,
      descripcion: m.descripcion,
      tipoMov: m.tipo,
      tipoAdj: "boleta",
      nombre: m.boleta_path.split("/").pop() ?? "boleta",
      path: m.boleta_path,
    });
  }

  // Ordenar cronologicamente para que el anexo siga el mismo orden que la tabla.
  brutos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const firmadas = await Promise.all(
    brutos.map(async (b) => {
      const { data } = await supabase.storage
        .from("boletas")
        .createSignedUrl(b.path, 3600);
      return data?.signedUrl ?? null;
    })
  );

  const boletas: BoletaResuelta[] = brutos
    .map((b, i) => {
      const url = firmadas[i];
      if (!url) return null;
      const esImagen = IMG_EXT.test(b.nombre) || IMG_EXT.test(b.path);
      const esPdf = PDF_EXT.test(b.nombre) || PDF_EXT.test(b.path);
      return {
        key: b.key,
        movimientoId: b.movimientoId,
        fecha: b.fecha,
        monto: b.monto,
        descripcion: b.descripcion,
        tipoMov: b.tipoMov,
        tipoAdj: b.tipoAdj,
        nombre: b.nombre,
        url,
        esImagen,
        esPdf,
      } satisfies BoletaResuelta;
    })
    .filter((x): x is BoletaResuelta => x !== null);

  const totalMovs = movimientos.length;
  const movsConAdjunto = new Set(boletas.map((b) => b.movimientoId)).size;
  const hoy = formatFechaLarga(new Date());

  return (
    <>
      {/* Estilos de impresion: contenido a papel limpio, salto de pagina por boleta */}
      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; break-before: page; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          body { background: white !important; }
          .boleta-img-wrap { max-height: 22cm; }
          a { color: inherit; text-decoration: none; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr, td, th { break-inside: avoid; }
        }
        .boleta-img-wrap img { max-width: 100%; height: auto; object-fit: contain; }
      `}</style>

      <PrintToolbar eventoId={id} />

      <div className="mx-auto max-w-4xl px-6 py-6 print:px-0 print:py-0">
        {/* Cabecera */}
        <header className="mb-6 border-b border-slate-300 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Tesorería CPCC · Colegio Carampangue
              </div>
              <h1 className="mt-1 text-2xl font-bold">{balance.nombre}</h1>
              <div className="mt-1 text-sm text-slate-600">
                Fecha del evento: {formatFecha(balance.fecha)}
                {balance.cerrado && <span className="ml-2">· Cerrado</span>}
              </div>
              {evento.descripcion && (
                <div className="mt-2 text-sm text-slate-700">
                  {evento.descripcion}
                </div>
              )}
            </div>
            <div className="text-right text-xs text-slate-500">
              Emitido: {hoy}
            </div>
          </div>

          {/* Totales */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded border border-slate-200 p-3">
              <div className="text-[10px] uppercase text-slate-500">
                Ingresos
              </div>
              <div className="mt-1 text-lg font-semibold text-green-700">
                {formatCLP(balance.ingresos)}
              </div>
            </div>
            <div className="rounded border border-slate-200 p-3">
              <div className="text-[10px] uppercase text-slate-500">
                Egresos
              </div>
              <div className="mt-1 text-lg font-semibold text-red-700">
                {formatCLP(balance.egresos)}
              </div>
            </div>
            <div className="rounded border border-slate-200 p-3">
              <div className="text-[10px] uppercase text-slate-500">Neto</div>
              <div
                className={`mt-1 text-lg font-semibold ${
                  balance.neto >= 0 ? "text-slate-900" : "text-red-700"
                }`}
              >
                {formatCLP(balance.neto)}
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            {totalMovs} movimiento{totalMovs === 1 ? "" : "s"} ·{" "}
            {movsConAdjunto} con respaldo adjunto ({boletas.length} archivo
            {boletas.length === 1 ? "" : "s"})
          </div>
        </header>

        {/* Tabla de movimientos */}
        <section className="avoid-break">
          <h2 className="mb-2 text-base font-semibold">
            Movimientos ({totalMovs})
          </h2>
          {totalMovs === 0 ? (
            <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              Este evento no tiene movimientos registrados.
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2">Fecha</th>
                  <th className="py-2 pr-2">Tipo</th>
                  <th className="py-2 pr-2 text-right">Monto</th>
                  <th className="py-2 pr-2">Descripción</th>
                  <th className="py-2 pr-2 text-center">Resp.</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => {
                  const respaldos = boletas.filter(
                    (b) => b.movimientoId === m.id
                  ).length;
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-slate-100 align-top"
                    >
                      <td className="py-2 pr-2 whitespace-nowrap">
                        {formatFecha(m.fecha)}
                      </td>
                      <td className="py-2 pr-2 capitalize">{m.tipo}</td>
                      <td
                        className={`py-2 pr-2 text-right font-medium whitespace-nowrap ${
                          m.tipo === "ingreso"
                            ? "text-green-700"
                            : "text-red-700"
                        }`}
                      >
                        {formatCLP(m.monto)}
                      </td>
                      <td className="py-2 pr-2">
                        {m.descripcion || (
                          <span className="text-slate-400">
                            (sin descripción)
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-center">
                        {respaldos > 0 ? respaldos : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-400 font-semibold">
                  <td className="py-2 pr-2" colSpan={2}>
                    Total ingresos
                  </td>
                  <td className="py-2 pr-2 text-right text-green-700">
                    {formatCLP(balance.ingresos)}
                  </td>
                  <td colSpan={2} />
                </tr>
                <tr className="font-semibold">
                  <td className="py-1 pr-2" colSpan={2}>
                    Total egresos
                  </td>
                  <td className="py-1 pr-2 text-right text-red-700">
                    {formatCLP(balance.egresos)}
                  </td>
                  <td colSpan={2} />
                </tr>
                <tr className="font-semibold">
                  <td className="py-1 pr-2" colSpan={2}>
                    Neto
                  </td>
                  <td
                    className={`py-1 pr-2 text-right ${
                      balance.neto >= 0 ? "text-slate-900" : "text-red-700"
                    }`}
                  >
                    {formatCLP(balance.neto)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        {/* Anexo de respaldos */}
        {boletas.length > 0 && (
          <section className="page-break mt-8">
            <h2 className="mb-1 text-base font-semibold">
              Anexo · Respaldos ({boletas.length})
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              Boletas, comprobantes y otros adjuntos asociados a los
              movimientos de este evento.
            </p>

            <div className="space-y-6">
              {boletas.map((b, idx) => (
                <article
                  key={b.key}
                  className={`avoid-break rounded border border-slate-200 p-4 ${
                    idx > 0 ? "page-break" : ""
                  }`}
                >
                  <header className="mb-3 flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Respaldo {idx + 1} de {boletas.length} · {b.tipoAdj}
                      </div>
                      <div className="mt-1 font-semibold">
                        {formatCLP(b.monto)} ·{" "}
                        <span className="capitalize font-normal">
                          {b.tipoMov}
                        </span>{" "}
                        · {formatFecha(b.fecha)}
                      </div>
                      {b.descripcion && (
                        <div className="text-sm text-slate-700">
                          {b.descripcion}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-slate-500">
                        Archivo: {b.nombre}
                      </div>
                    </div>
                  </header>

                  {b.esImagen ? (
                    <div className="boleta-img-wrap flex justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={b.url}
                        alt={`Respaldo de ${b.descripcion ?? "movimiento"}`}
                        className="max-h-[70vh] w-auto max-w-full border border-slate-100 print:max-h-none"
                      />
                    </div>
                  ) : b.esPdf ? (
                    <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                      Este respaldo es un archivo PDF y no se puede incrustar en
                      la impresión.{" "}
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-700 underline no-print"
                      >
                        Abrir PDF
                      </a>
                      <div className="mt-1 text-xs text-slate-500">
                        Sugerencia: abre el PDF e imprímelo por separado si
                        necesitas anexarlo al documento en papel.
                      </div>
                    </div>
                  ) : (
                    <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                      Este respaldo no es una imagen ({b.nombre}).{" "}
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-700 underline no-print"
                      >
                        Abrir archivo
                      </a>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
          Tesorería CPCC — Colegio Carampangue · Documento generado el {hoy}
        </footer>
      </div>
    </>
  );
}
