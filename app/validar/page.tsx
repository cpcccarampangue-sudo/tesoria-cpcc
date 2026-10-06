import Image from "next/image";
import { AppFooter } from "@/components/app-footer";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { ValidadorClient } from "./validador-client";

export const metadata = {
  title: "Validar QR de socio — CPCC",
};
export const dynamic = "force-dynamic";

export default function ValidarPage() {
  const anio = new Date().getFullYear();
  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA]">
      {/* Header institucional compacto */}
      <header className="w-full bg-white border-b border-slate-200">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            width={48}
            height={48}
            className="h-11 w-11 object-contain flex-shrink-0"
            priority
          />
          <div className="flex-1 min-w-0">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "#1e3a8a" }}
            >
              {INSTITUCION_NOMBRE}
            </p>
            <h1 className="text-base font-semibold text-slate-900 leading-tight">
              Validador de socios
            </h1>
          </div>
          <span
            className="inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-semibold tracking-wide text-white"
            style={{ background: "#F08C00" }}
          >
            {anio}
          </span>
        </div>
      </header>

      {/* Contenido */}
      <div className="flex-1 w-full max-w-md mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <ValidadorClient />
        </div>

        <details className="group bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
          <summary className="cursor-pointer px-4 py-3 flex items-center justify-between list-none select-none [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-medium text-slate-700">
              ¿Cómo funciona?
            </span>
            <svg
              className="w-4 h-4 text-slate-400 transition-transform duration-200 group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </summary>
          <div className="px-4 pb-4 text-xs text-slate-600 space-y-1 border-t border-slate-100 pt-3">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Toca <strong>Escanear QR</strong> y autoriza la cámara.
              </li>
              <li>Centra el código del apoderado dentro del marco.</li>
              <li>
                Verde = socio activo del período vigente. Rojo = no válido
                (con el motivo).
              </li>
              <li>
                <strong>Instalar en celular:</strong> desde el menú del
                navegador elige &quot;Agregar a pantalla de inicio&quot;.
              </li>
            </ul>
          </div>
        </details>

        <p className="mt-4 text-xs text-slate-500 text-center">
          Validación en tiempo real contra la base del Centro de Padres.
        </p>
      </div>

      <AppFooter />
    </div>
  );
}
