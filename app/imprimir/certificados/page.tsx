import Image from "next/image";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCLP, formatFechaLarga } from "@/lib/formatters";
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
import { resolverFirmantes, type FirmanteConFirma } from "@/lib/firmas";
import { PrintToolbar } from "./print-toolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificado — Tesorería CPCC" };

const CARGOS_VALIDOS: DirectivaCargo[] = [
  "presidente",
  "vicepresidente",
  "tesorero",
  "protesorero",
  "secretario",
  "director",
];

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

function firstParam(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

// Reemplaza los placeholders {{clave}} en el cuerpo por el valor
// correspondiente. Si el valor esta vacio, deja una linea en blanco visible
// para llenar a mano.
function renderCuerpo(
  cuerpo: string,
  vars: Record<string, string>
): React.ReactNode[] {
  const partes: React.ReactNode[] = [];
  const regex = /\{\{(\w+)\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(cuerpo)) !== null) {
    if (match.index > last) {
      partes.push(cuerpo.slice(last, match.index));
    }
    const clave = match[1];
    const valor = vars[clave] ?? "";
    if (valor) {
      partes.push(
        <strong key={`v-${key++}`}>{valor}</strong>
      );
    } else {
      partes.push(
        <span
          key={`b-${key++}`}
          className="inline-block min-w-[140px] border-b border-slate-800 align-baseline"
        >
          &nbsp;
        </span>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < cuerpo.length) partes.push(cuerpo.slice(last));
  return partes;
}

export default async function ImprimirCertificadoPage({
  searchParams,
}: {
  searchParams: Promise<{
    titulo?: string;
    subtitulo?: string;
    cuerpo?: string;
    nombre?: string;
    rut?: string;
    fecha?: string;
    monto?: string;
    firmantes?: string | string[];
  }>;
}) {
  await requireDirectiva();
  const sp = await searchParams;

  const titulo = firstParam(sp.titulo).trim() || "CERTIFICADO";
  const subtitulo = firstParam(sp.subtitulo).trim();
  const cuerpo =
    firstParam(sp.cuerpo).trim() || "(sin contenido — vuelve a /certificados)";
  const nombre = firstParam(sp.nombre).trim();
  const rut = firstParam(sp.rut).trim();
  const fecha = firstParam(sp.fecha) || new Date().toISOString().slice(0, 10);
  const montoRaw = firstParam(sp.monto);
  const monto = Number(montoRaw);
  const montoValido = Number.isFinite(monto) && monto > 0;
  const cargosPedidos = parseFirmantes(sp.firmantes);

  const supabase = await createSupabaseServerClient();
  const { data: dirData } = await supabase
    .from("directiva_miembros")
    .select("*")
    .eq("activo", true);
  const directivaActiva = (dirData as DirectivaMiembro[] | null) ?? [];

  const firmantes = await resolverFirmantes(cargosPedidos, directivaActiva, {
    nombre: TESORERO_NOMBRE,
    rut: TESORERO_RUT,
  });

  const fechaLarga = formatFechaLarga(fecha);
  const hoy = formatFechaLarga(new Date());
  const vars: Record<string, string> = {
    nombre,
    rut,
    fecha: fechaLarga,
    monto: montoValido ? formatCLP(monto) : "",
    institucion: INSTITUCION_NOMBRE,
  };

  const parrafos = cuerpo.split(/\n\n+/);
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
        <header className="mb-4 flex justify-center border-b border-slate-300 pb-3">
          <Image
            src="/logo.png"
            alt="Logo del colegio"
            width={220}
            height={220}
            className="h-40 w-40 object-contain"
            priority
          />
        </header>

        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>
            Folio N°: <span className="font-mono">CERT-{folio}</span>
          </span>
          <span>Emitido: {hoy}</span>
        </div>

        <h1 className="mt-6 text-center text-2xl font-bold uppercase tracking-widest">
          {titulo}
        </h1>
        {subtitulo && (
          <div className="mt-1 text-center text-sm text-slate-700 italic">
            {subtitulo}
          </div>
        )}

        <div className="mt-8 space-y-4 text-justify text-[13px] leading-relaxed">
          {parrafos.map((p, i) => (
            <p key={i}>{renderCuerpo(p, vars)}</p>
          ))}
        </div>

        {/* Firmas */}
        {firmantes.length === 1 ? (
          <div className="mt-20 flex justify-center text-[12px]">
            <div className="w-72">
              <FirmaCargoBlock f={firmantes[0]} />
            </div>
          </div>
        ) : (
          <div className="mt-20 grid grid-cols-2 gap-8 text-[12px]">
            {firmantes.map((f) => (
              <FirmaCargoBlock key={f.cargo} f={f} />
            ))}
          </div>
        )}

        <footer className="mt-10 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
          Documento emitido por la Tesorería del {INSTITUCION_NOMBRE} ·
          Certificado · Folio CERT-{folio}
        </footer>
      </div>
    </>
  );
}

function FirmaCargoBlock({ f }: { f: FirmanteConFirma }) {
  return (
    <div className="text-center">
      <div className="h-14 print:h-16 flex items-end justify-center overflow-hidden">
        {f.firmaUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={f.firmaUrl}
            alt={`Firma ${f.nombre}`}
            className="max-h-full max-w-[180px] object-contain"
          />
        )}
      </div>
      <div className="border-t border-slate-800" />
      <div className="font-bold uppercase mt-1">
        {DIRECTIVA_CARGO_LABEL[f.cargo]}
      </div>
      <div className="mt-1">{f.nombre}</div>
      <div>RUT: {f.rut?.trim() || "__________________________"}</div>
      <div>{INSTITUCION_NOMBRE}</div>
    </div>
  );
}
