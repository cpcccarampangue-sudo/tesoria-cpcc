import { redirect } from "next/navigation";
import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { getValidadorContexto } from "@/lib/auth";
import { AccesoForm } from "./acceso-form";

export const metadata = {
  title: "Acceso de operador — Validar socio",
};
export const dynamic = "force-dynamic";

export default async function AccesoPage() {
  // Si el usuario ya tiene contexto valido (directiva o operador), lo
  // mandamos directo a /validar; no tiene sentido pedir OTP otra vez.
  const ctx = await getValidadorContexto();
  if (ctx) redirect("/validar");

  const anio = new Date().getFullYear();
  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA]">
      <PublicHeader activa="validar" badge={`VALIDADOR ${anio}`} />
      <div className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 pt-6 pb-8">
        <div className="mb-4">
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "#1e3a8a" }}
          >
            Acceso para convenios
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Si tu correo está autorizado por un convenio, ingrésalo para recibir
            un código y acceder al validador.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
          <AccesoForm />
        </div>

        <p className="text-xs text-slate-500 mt-4 text-center leading-relaxed">
          ¿Eres directiva del CdP? Usa tu correo y contraseña en{" "}
          <a href="/login" className="underline">
            login
          </a>{" "}
          — no necesitas este flujo.
        </p>
      </div>
      <PublicFooter />
    </div>
  );
}
