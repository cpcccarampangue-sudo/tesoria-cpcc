import { PublicHeader } from "@/components/public-header";
import { PublicFooter } from "@/components/public-footer";
import { requireDirectiva } from "@/lib/auth";
import { ValidadorClient } from "./validador-client";

export const metadata = {
  title: "Validar socio — Centro de Padres CPCC",
};
export const dynamic = "force-dynamic";

export default async function ValidarPage() {
  // El validador solo esta accesible para directiva. Si no hay sesion
  // o el rol no es directiva, requireDirectiva() redirige a /login o
  // /dashboard respectivamente. Cuando se implemente el modulo
  // convenios, agregar un chequeo adicional para rol operador aqui.
  await requireDirectiva();

  const anio = new Date().getFullYear();
  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8FA]">
      <PublicHeader activa="validar" badge={`VALIDADOR ${anio}`} />

      {/* Hero */}
      <section className="w-full">
        <div className="max-w-xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-4 text-center sm:text-left">
          <h1
            className="text-2xl sm:text-3xl font-semibold tracking-tight leading-tight"
            style={{ color: "#1e3a8a" }}
          >
            Validador de socios
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Centro de Padres Colegio Carampangue
          </p>
          <p className="text-sm sm:text-base text-slate-600 mt-3 max-w-lg">
            Escanea el código QR de la credencial de socio para verificar su
            vigencia.
          </p>
        </div>
      </section>

      {/* Card principal */}
      <div className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 pb-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
          <ValidadorClient />
        </div>

        {/* Cómo funciona */}
        <section id="ayuda" className="mt-8 scroll-mt-24">
          <h2 className="text-base font-semibold text-slate-900">
            ¿Cómo funciona?
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Rápido, seguro y sin exponer datos personales.
          </p>
          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <HelpBlock
              num="01"
              titulo="Escanear"
              texto="Toca el botón, autoriza la cámara y centra el QR en el marco."
            />
            <HelpBlock
              num="02"
              titulo="Validar"
              texto="Verificamos la credencial contra la base del Centro de Padres."
            />
            <HelpBlock
              num="03"
              titulo="Resultado"
              texto="Mostramos sólo lo necesario: nombre reducido, estado y vigencia."
            />
          </ol>
          <p className="text-xs text-slate-500 mt-4 leading-relaxed">
            Puedes instalar esta pantalla como app en tu celular desde el
            menú del navegador, &quot;Agregar a pantalla de inicio&quot;.
          </p>
        </section>
      </div>

      <PublicFooter />
    </div>
  );
}

function HelpBlock({
  num,
  titulo,
  texto,
}: {
  num: string;
  titulo: string;
  texto: string;
}) {
  return (
    <li className="rounded-xl bg-white border border-slate-200 p-4">
      <div
        className="text-[11px] font-semibold tracking-widest"
        style={{ color: "#F08C00" }}
      >
        {num}
      </div>
      <div className="text-sm font-semibold text-slate-900 mt-0.5">
        {titulo}
      </div>
      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{texto}</p>
    </li>
  );
}
