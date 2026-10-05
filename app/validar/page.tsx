import Image from "next/image";
import { AppFooter } from "@/components/app-footer";
import { INSTITUCION_NOMBRE } from "@/lib/config";
import { ValidadorClient } from "./validador-client";

export const metadata = {
  title: "Validar QR de socio — CPCC",
};
export const dynamic = "force-dynamic";

export default function ValidarPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-1 w-full max-w-md mx-auto px-4 py-6">
        <header className="text-center mb-4">
          <Image
            src="/logo.png"
            alt="Centro de Padres"
            width={120}
            height={120}
            className="mx-auto h-20 w-20 object-contain mb-2"
            priority
          />
          <h1 className="text-xl font-semibold text-slate-900">
            Validador de socios
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {INSTITUCION_NOMBRE} — Colegio Carampangue
          </p>
        </header>

        <ValidadorClient />

        <div className="card bg-slate-50 text-xs text-slate-600 mt-4 space-y-1">
          <div className="font-semibold text-slate-800">💡 Cómo funciona</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Toca <strong>Escanear QR</strong> y permite el acceso a la cámara.
            </li>
            <li>
              Apunta al código QR que te muestra el apoderado desde su correo
              o celular.
            </li>
            <li>
              Si es un socio activo del año en curso, se muestra tarjeta
              verde con los datos. Si no, roja con el motivo.
            </li>
            <li>
              <strong>Instalar en celular</strong>: desde el navegador toca el
              menú de la URL y elige &quot;Agregar a pantalla de inicio&quot;.
              Queda como una app para abrir rápido en eventos y convenios.
            </li>
          </ul>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
