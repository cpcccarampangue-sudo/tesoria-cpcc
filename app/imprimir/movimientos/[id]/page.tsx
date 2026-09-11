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
import {
  DIRECTIVA_CARGO_LABEL,
  type Categoria,
  type DirectivaCargo,
  type DirectivaMiembro,
  type Movimiento,
} from "@/lib/types";
import { PrintToolbar } from "./print-toolbar";

export const dynamic = "force-dynamic";

// Cargos permitidos como firmantes del acta (subset de DirectivaCargo).
const CARGOS_VALIDOS: DirectivaCargo[] = [
  "presidente",
  "vicepresidente",
  "tesorero",
  "protesorero",
  "secretario",
  "director",
];

// Firmante = miembro real de la directiva, o fallback hardcoded (solo tesorero).
type Firmante = { cargo: DirectivaCargo; nombre: string; rut: string };

function parseFirmantes(raw: string | string[] | undefined): DirectivaCargo[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw ?? "tesorero";
  const cargos = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DirectivaCargo =>
      CARGOS_VALIDOS.includes(s as DirectivaCargo)
    );
  // Deduplicar preservando orden. Si vino vacio, default "tesorero".
  const seen = new Set<DirectivaCargo>();
  const out: DirectivaCargo[] = [];
  for (const c of cargos) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out.length > 0 ? out : ["tesorero"];
}

export default async function ImprimirActaMovimientoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ firmantes?: string | string[] }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const cargosPedidos = parseFirmantes(sp.firmantes);

  const [{ data: movData }, { data: dirData }] = await Promise.all([
    supabase.from("movimientos").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("directiva_miembros")
      .select("*")
      .eq("activo", true),
  ]);

  if (!movData) notFound();
  const m = movData as Movimiento;
  const directivaActiva = (dirData as DirectivaMiembro[] | null) ?? [];

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

  // Resolver firmantes: buscar miembro activo por cargo. Si no hay y el cargo
  // es "tesorero", caemos al hardcoded para no romper la funcionalidad.
  const firmantes: Firmante[] = [];
  for (const cargo of cargosPedidos) {
    const miembro = directivaActiva.find((d) => d.cargo === cargo);
    if (miembro) {
      firmantes.push({ cargo, nombre: miembro.nombre, rut: miembro.rut });
    } else if (cargo === "tesorero") {
      firmantes.push({
        cargo: "tesorero",
        nombre: TESORERO_NOMBRE,
        rut: TESORERO_RUT,
      });
    }
    // Si el cargo pedido no tiene miembro activo (y no es tesorero), simplemente
    // no aparece. El aviso al usuario ocurre en el detalle del movimiento donde
    // se elige, asi que aca no interrumpimos la impresion.
  }

  const fechaMovLarga = formatFechaLarga(m.fecha);
  const hoy = formatFechaLarga(new Date());
  const montoPalabras = montoCLPEnPalabras(m.monto);
  const concepto =
    m.descripcion?.trim() ||
    categoria?.nombre ||
    "Egreso registrado en tesorería";

  // Para el prefacio, mencionamos al tesorero (el que entrega la plata).
  const tesoreroFirmante =
    firmantes.find((f) => f.cargo === "tesorero") ?? {
      cargo: "tesorero" as DirectivaCargo,
      nombre: TESORERO_NOMBRE,
      rut: TESORERO_RUT,
    };

  return (
    <>
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
            El acta de recibo está pensada para{" "}
            <strong>egresos en efectivo</strong>. Este movimiento es{" "}
            {m.es_transferencia
              ? "una transferencia interna"
              : `un ${m.tipo}`}
            . Puedes imprimirlo igual, pero revisa que el documento tenga
            sentido para tu caso.
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
            Folio N°:{" "}
            <span className="font-mono">{id.slice(0, 8).toUpperCase()}</span>
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
            {INSTITUCION_NOMBRE}, representada por don/doña{" "}
            <strong>{tesoreroFirmante.nombre}</strong>, RUT{" "}
            <strong>{tesoreroFirmante.rut}</strong>, la suma de:
          </p>
        </div>

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
          Con la firma del presente documento se deja constancia de la entrega
          y recepción íntegra del monto señalado, no quedando pendiente pago
          alguno por este concepto entre las partes.
        </p>

        {/* Firma del que recibe */}
        <div className="mt-14 flex justify-center">
          <div className="w-72 text-center text-[12px]">
            <div className="mb-1 border-t border-slate-800" />
            <div className="font-bold uppercase">Recibe conforme</div>
            <div className="mt-1">Nombre: ______________________________</div>
            <div>RUT: __________________________________</div>
            <div>Firma</div>
          </div>
        </div>

        {/* Firmas del CdP (1 o mas) */}
        <div
          className={`mt-14 grid gap-8 text-[12px] ${
            firmantes.length >= 2 ? "grid-cols-2" : "grid-cols-1 justify-items-center"
          }`}
        >
          {firmantes.map((f) => (
            <div key={f.cargo} className="text-center">
              <div className="mb-1 border-t border-slate-800" />
              <div className="font-bold uppercase">
                {DIRECTIVA_CARGO_LABEL[f.cargo]}
              </div>
              <div className="mt-1">{f.nombre}</div>
              <div>RUT: {f.rut}</div>
              <div>{INSTITUCION_NOMBRE}</div>
            </div>
          ))}
        </div>

        <footer className="mt-10 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
          Documento emitido por la Tesorería del {INSTITUCION_NOMBRE} ·
          Comprobante interno de egreso · Folio{" "}
          {id.slice(0, 8).toUpperCase()}
        </footer>
      </div>
    </>
  );
}
