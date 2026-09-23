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
  type DirectivaCargo,
  type DirectivaMiembro,
} from "@/lib/types";
import { PrintToolbar } from "./print-toolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acta de recibo — Tesorería CPCC" };

const CARGOS_VALIDOS: DirectivaCargo[] = [
  "presidente",
  "vicepresidente",
  "tesorero",
  "protesorero",
  "secretario",
  "director",
];

type Direccion = "egreso" | "ingreso";
type Medio = "efectivo" | "transferencia" | "cheque";
type Firmante = { cargo: DirectivaCargo; nombre: string; rut: string };

const MEDIO_LABEL: Record<Medio, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia bancaria",
  cheque: "Cheque",
};

function parseFirmantes(raw: string | string[] | undefined): DirectivaCargo[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw ?? "tesorero";
  const cargos = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is DirectivaCargo =>
      CARGOS_VALIDOS.includes(s as DirectivaCargo)
    );
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

function parseDireccion(raw: string | string[] | undefined): Direccion {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "ingreso" ? "ingreso" : "egreso";
}

function parseMedio(raw: string | string[] | undefined): Medio {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "transferencia" || v === "cheque") return v;
  return "efectivo";
}

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

export default async function ImprimirActaPage({
  searchParams,
}: {
  searchParams: Promise<{
    direccion?: string;
    monto?: string;
    concepto?: string;
    fecha?: string;
    persona_nombre?: string;
    persona_rut?: string;
    ciudad?: string;
    medio?: string;
    firmantes?: string | string[];
  }>;
}) {
  await requireDirectiva();
  const sp = await searchParams;

  const direccion = parseDireccion(sp.direccion);
  const montoRaw = firstParam(sp.monto);
  const monto = Number(montoRaw);
  const concepto = firstParam(sp.concepto).trim() || "Sin concepto especificado";
  const fecha = firstParam(sp.fecha) || new Date().toISOString().slice(0, 10);
  const personaNombre = firstParam(sp.persona_nombre).trim();
  const personaRut = firstParam(sp.persona_rut).trim();
  const ciudad = firstParam(sp.ciudad).trim();
  const medio = parseMedio(sp.medio);
  const cargosPedidos = parseFirmantes(sp.firmantes);

  const montoValido = Number.isFinite(monto) && monto > 0;

  const supabase = await createSupabaseServerClient();
  const { data: dirData } = await supabase
    .from("directiva_miembros")
    .select("*")
    .eq("activo", true);
  const directivaActiva = (dirData as DirectivaMiembro[] | null) ?? [];

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
  }

  const tesoreroFirmante =
    firmantes.find((f) => f.cargo === "tesorero") ?? {
      cargo: "tesorero" as DirectivaCargo,
      nombre: TESORERO_NOMBRE,
      rut: TESORERO_RUT,
    };

  const fechaLarga = formatFechaLarga(fecha);
  const hoy = formatFechaLarga(new Date());
  const montoPalabras = montoValido ? montoCLPEnPalabras(monto) : "—";

  // Folio ad-hoc basado en fecha y hora de emisión para tener algo único
  // y legible en un acta que no se persiste en la BD.
  const folio = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(2, 14);

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

      <PrintToolbar />

      <div className="mx-auto max-w-3xl px-6 py-6 print:px-0 print:py-0">
        {!montoValido && (
          <div className="no-print mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            El monto recibido no es válido. Vuelve a{" "}
            <a href="/actas" className="underline font-medium">
              /actas
            </a>{" "}
            y genera el acta con los datos correctos.
          </div>
        )}

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
            Folio N°: <span className="font-mono">{folio}</span>
          </span>
          <span>Emitido: {hoy}</span>
        </div>

        <h1 className="mt-4 text-center text-xl font-bold uppercase tracking-widest">
          Acta de Recibo de Dineros
        </h1>

        <div className="mt-6 text-justify text-[13px] leading-relaxed">
          {direccion === "egreso" ? (
            <ActaEgresoPrefacio
              ciudad={ciudad}
              fechaLarga={fechaLarga}
              personaNombre={personaNombre}
              personaRut={personaRut}
              tesorero={tesoreroFirmante}
            />
          ) : (
            <ActaIngresoPrefacio
              ciudad={ciudad}
              fechaLarga={fechaLarga}
              personaNombre={personaNombre}
              personaRut={personaRut}
              tesorero={tesoreroFirmante}
            />
          )}
        </div>

        <div className="mt-4 border border-slate-800 p-4 text-[13px]">
          <div className="grid grid-cols-[160px_1fr] gap-y-2">
            <div className="font-bold">Monto en números:</div>
            <div className="font-bold">
              {montoValido ? `${formatCLP(monto)}.-` : "—"}
            </div>

            <div className="font-bold">Monto en palabras:</div>
            <div className="capitalize">
              {montoValido ? `${montoPalabras} chilenos` : "—"}
            </div>

            <div className="font-bold">Concepto:</div>
            <div>{concepto}</div>

            <div className="font-bold">Medio de entrega:</div>
            <div>{MEDIO_LABEL[medio]}</div>
          </div>
        </div>

        <p className="mt-4 text-justify text-[13px] leading-relaxed">
          Con la firma del presente documento se deja constancia de la entrega
          y recepción íntegra del monto señalado, no quedando pendiente pago
          alguno por este concepto entre las partes.
        </p>

        {/* Firma de la contraparte (recibe o entrega segun direccion) */}
        <div className="mt-14 flex justify-center">
          <div className="w-72 text-center text-[12px]">
            <div className="mb-1 border-t border-slate-800" />
            <div className="font-bold uppercase">
              {direccion === "egreso" ? "Recibe conforme" : "Entrega conforme"}
            </div>
            <div className="mt-1">
              Nombre: {personaNombre || "______________________________"}
            </div>
            <div>RUT: {personaRut || "__________________________________"}</div>
            <div>Firma</div>
          </div>
        </div>

        {/* Firmas de la directiva */}
        <div
          className={`mt-14 grid gap-8 text-[12px] ${
            firmantes.length >= 2
              ? "grid-cols-2"
              : "grid-cols-1 justify-items-center"
          }`}
        >
          {firmantes.map((f) => (
            <div key={f.cargo} className="text-center">
              <div className="mb-1 border-t border-slate-800" />
              <div className="font-bold uppercase">
                {DIRECTIVA_CARGO_LABEL[f.cargo]}
              </div>
              <div className="mt-1">{f.nombre}</div>
              <div>
                RUT: {f.rut?.trim() || "__________________________"}
              </div>
              <div>{INSTITUCION_NOMBRE}</div>
            </div>
          ))}
        </div>

        <footer className="mt-10 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
          Documento emitido por la Tesorería del {INSTITUCION_NOMBRE} ·
          Comprobante interno {direccion === "egreso" ? "de egreso" : "de ingreso"} ·
          Folio {folio}
        </footer>
      </div>
    </>
  );
}

function ActaEgresoPrefacio({
  ciudad,
  fechaLarga,
  personaNombre,
  personaRut,
  tesorero,
}: {
  ciudad: string;
  fechaLarga: string;
  personaNombre: string;
  personaRut: string;
  tesorero: Firmante;
}) {
  return (
    <p>
      En la ciudad de{" "}
      {ciudad ? (
        <strong>{ciudad}</strong>
      ) : (
        <span className="inline-block min-w-[220px] border-b border-slate-800">
          &nbsp;
        </span>
      )}
      , con fecha <strong>{fechaLarga}</strong>, yo,{" "}
      {personaNombre ? (
        <strong>{personaNombre}</strong>
      ) : (
        <span className="inline-block min-w-[280px] border-b border-slate-800">
          &nbsp;
        </span>
      )}
      , cédula de identidad N°{" "}
      {personaRut ? (
        <strong>{personaRut}</strong>
      ) : (
        <span className="inline-block min-w-[140px] border-b border-slate-800">
          &nbsp;
        </span>
      )}
      , declaro haber recibido conforme, de parte de la Tesorería del{" "}
      {INSTITUCION_NOMBRE}, representada por don/doña{" "}
      <strong>{tesorero.nombre}</strong>
      {tesorero.rut?.trim() && (
        <>
          , RUT <strong>{tesorero.rut}</strong>
        </>
      )}
      , la suma de:
    </p>
  );
}

function ActaIngresoPrefacio({
  ciudad,
  fechaLarga,
  personaNombre,
  personaRut,
  tesorero,
}: {
  ciudad: string;
  fechaLarga: string;
  personaNombre: string;
  personaRut: string;
  tesorero: Firmante;
}) {
  return (
    <p>
      En la ciudad de{" "}
      {ciudad ? (
        <strong>{ciudad}</strong>
      ) : (
        <span className="inline-block min-w-[220px] border-b border-slate-800">
          &nbsp;
        </span>
      )}
      , con fecha <strong>{fechaLarga}</strong>, la Tesorería del{" "}
      {INSTITUCION_NOMBRE}, representada por don/doña{" "}
      <strong>{tesorero.nombre}</strong>
      {tesorero.rut?.trim() && (
        <>
          , RUT <strong>{tesorero.rut}</strong>
        </>
      )}
      , declara haber recibido conforme, de parte de don/doña{" "}
      {personaNombre ? (
        <strong>{personaNombre}</strong>
      ) : (
        <span className="inline-block min-w-[280px] border-b border-slate-800">
          &nbsp;
        </span>
      )}
      , cédula de identidad N°{" "}
      {personaRut ? (
        <strong>{personaRut}</strong>
      ) : (
        <span className="inline-block min-w-[140px] border-b border-slate-800">
          &nbsp;
        </span>
      )}
      , la suma de:
    </p>
  );
}
