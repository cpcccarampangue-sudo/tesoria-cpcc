import { notFound } from "next/navigation";
import Image from "next/image";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatCLP,
  formatFechaLarga,
  montoCLPEnPalabras,
} from "@/lib/formatters";
import {
  INSTITUCION_NOMBRE,
  TESORERO_NOMBRE,
  TESORERO_RUT,
} from "@/lib/config";
import type { Categoria, Movimiento } from "@/lib/types";
import { PrintToolbar } from "./print-toolbar";

export const dynamic = "force-dynamic";

export default async function ImprimirActaMovimientoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("movimientos")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const m = data as Movimiento;

  // El acta de recibo tiene sentido solo para egresos NO-transferencia.
  // Si alguien llega aca con un ingreso o una transferencia, mostramos aviso.
  const permitida = m.tipo === "egreso" && !m.es_transferencia;

  let categoria: Categoria | null = null;
  if (m.categoria_id) {
    const { data: cat } = await supabase
      .from("categorias")
      .select("id, nombre, tipo, activa")
      .eq("id", m.categoria_id)
      .maybeSingle();
    categoria = (cat as Categoria | null) ?? null;
  }

  const fechaMovLarga = formatFechaLarga(m.fecha);
  const hoy = formatFechaLarga(new Date());
  const montoPalabras = montoCLPEnPalabras(m.monto);
  const concepto = m.descripcion?.trim() || categoria?.nombre || "Egreso registrado en tesorería";

  return (
    <>
      {/* Estilos de impresion: papel Carta, sin cabeceras del navegador */}
      <style>{`
        @media print {
          @page { size: Letter; margin: 2.2cm 2.5cm; }
          .no-print { display: none !important; }
          body { background: white !important; }
          a { color: inherit; text-decoration: none; }
        }
      `}</style>

      <PrintToolbar movimientoId={id} />

      <div className="mx-auto max-w-3xl px-6 py-6 print:px-0 print:py-0">
        {!permitida && (
          <div className="no-print mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            El acta de recibo está pensada para <strong>egresos en efectivo</strong>. Este
            movimiento es {m.es_transferencia ? "una transferencia interna" : `un ${m.tipo}`}
            . Puedes imprimirlo igual, pero revisa que el documento tenga sentido para tu caso.
          </div>
        )}

        {/* Cabecera institucional */}
        <header className="mb-6 flex items-center justify-center gap-4 border-b-2 border-slate-800 pb-3">
          <Image
            src="/logo.png"
            alt="Logo del colegio"
            width={72}
            height={72}
            className="h-16 w-16 object-contain"
            priority
          />
          <div className="text-center">
            <div className="text-sm font-bold uppercase tracking-wide">
              {INSTITUCION_NOMBRE}
            </div>
            <div className="text-xs text-slate-600">Tesorería</div>
          </div>
        </header>

        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>
            Folio N°: <span className="font-mono">{id.slice(0, 8).toUpperCase()}</span>
          </span>
          <span>Emitido: {hoy}</span>
        </div>

        <h1 className="mt-4 text-center text-xl font-bold uppercase tracking-widest">
          Acta de Recibo de Dineros
        </h1>

        <div className="mt-6 text-justify text-[13px] leading-relaxed">
          <p>
            En la ciudad de{" "}
            <span className="inline-block min-w-[220px] border-b border-slate-800">
              &nbsp;
            </span>
            , con fecha <strong>{fechaMovLarga}</strong>, yo,{" "}
            <span className="inline-block min-w-[280px] border-b border-slate-800">
              &nbsp;
            </span>
            , cédula de identidad N°{" "}
            <span className="inline-block min-w-[140px] border-b border-slate-800">
              &nbsp;
            </span>
            , declaro haber recibido conforme, de parte de la Tesorería del{" "}
            {INSTITUCION_NOMBRE}, representada por don{" "}
            <strong>{TESORERO_NOMBRE}</strong>, RUT <strong>{TESORERO_RUT}</strong>, la
            suma de:
          </p>
        </div>

        {/* Cuadro de datos */}
        <div className="mt-4 border border-slate-800 p-4 text-[13px]">
          <div className="grid grid-cols-[160px_1fr] gap-y-2">
            <div className="font-bold">Monto en números:</div>
            <div className="font-bold">{formatCLP(m.monto)}.-</div>

            <div className="font-bold">Monto en palabras:</div>
            <div className="capitalize">{montoPalabras} chilenos</div>

            <div className="font-bold">Concepto:</div>
            <div>{concepto}</div>

            <div className="font-bold">Medio de entrega:</div>
            <div>Efectivo</div>
          </div>
        </div>

        <p className="mt-4 text-justify text-[13px] leading-relaxed">
          Con la firma del presente documento se deja constancia de la entrega y
          recepción íntegra del monto señalado, no quedando pendiente pago alguno por
          este concepto entre las partes.
        </p>

        {/* Firmas */}
        <div className="mt-16 grid grid-cols-2 gap-10 text-[12px]">
          <div className="text-center">
            <div className="mb-1 border-t border-slate-800" />
            <div className="font-bold uppercase">Recibe conforme</div>
            <div className="mt-1">Nombre: ______________________________</div>
            <div>RUT: __________________________________</div>
            <div>Firma</div>
          </div>
          <div className="text-center">
            <div className="mb-1 border-t border-slate-800" />
            <div className="font-bold uppercase">Entrega</div>
            <div className="mt-1">{TESORERO_NOMBRE}</div>
            <div>RUT: {TESORERO_RUT}</div>
            <div>Tesorero — {INSTITUCION_NOMBRE}</div>
          </div>
        </div>

        <footer className="mt-10 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
          Documento emitido por la Tesorería del {INSTITUCION_NOMBRE} · Comprobante
          interno de egreso · Folio {id.slice(0, 8).toUpperCase()}
        </footer>
      </div>
    </>
  );
}
