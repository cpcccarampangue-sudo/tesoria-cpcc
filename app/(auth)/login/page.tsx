import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar — Tesorería CPCC" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; debug?: string }>;
}) {
  const params = await searchParams;
  const anio = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white">
      {/* ================================================================
          COLUMNA IZQUIERDA — Identidad institucional
          Desktop: 55% de ancho, fondo claro con acentos sutiles
          Mobile: oculto (se reemplaza por header compacto arriba del form)
          ================================================================ */}
      <aside
        className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-white"
        aria-hidden="true"
      >
        {/* Decoraciones sutiles — líneas y formas inspiradas en el logo */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Degradado blanco → azul muy claro */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, #ffffff 0%, #f8fafc 55%, #eff5fb 100%)",
            }}
          />
          {/* Línea diagonal azul oscuro muy delgada */}
          <div
            className="absolute left-0 top-0 h-full w-px"
            style={{
              background:
                "linear-gradient(180deg, transparent 0%, #1e3a8a22 30%, #1e3a8a22 70%, transparent 100%)",
            }}
          />
          {/* Acento naranjo discreto arriba a la izquierda */}
          <div
            className="absolute top-20 left-16 w-24 h-24 rounded-full opacity-[0.08]"
            style={{ background: "#F08C00" }}
          />
          {/* Acento azul institucional abajo a la derecha */}
          <div
            className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full opacity-[0.05]"
            style={{ background: "#1e3a8a" }}
          />
          {/* Patrón de puntos muy sutil */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "radial-gradient(circle, #1e3a8a 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
        </div>

        {/* Contenido principal centrado */}
        <div className="relative z-10 flex flex-col justify-center w-full px-16 xl:px-24 py-16 max-w-3xl mx-auto">
          {/* Logo CPCC */}
          <div className="mb-10">
            <Image
              src="/logo.png"
              alt="Centro de Padres Colegio Carampangue"
              width={200}
              height={200}
              className="h-40 w-auto"
              priority
            />
          </div>

          {/* Headline */}
          <h1 className="text-4xl xl:text-5xl font-semibold tracking-tight leading-tight mb-5"
              style={{ color: "#1e3a8a" }}>
            Información clara.
            <br />
            Gestión transparente.
          </h1>

          {/* Subtítulo */}
          <p className="text-base xl:text-lg text-slate-600 leading-relaxed max-w-md mb-10">
            Accede a la información de tesorería del Centro de Padres de
            manera simple, ordenada y segura.
          </p>

          {/* Beneficios discretos */}
          <ul className="space-y-3 text-slate-700">
            <li className="flex items-center gap-3">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: "#F08C00" }}
              />
              <span className="text-sm">Información centralizada</span>
            </li>
            <li className="flex items-center gap-3">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: "#F08C00" }}
              />
              <span className="text-sm">Acceso personal</span>
            </li>
            <li className="flex items-center gap-3">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: "#F08C00" }}
              />
              <span className="text-sm">Gestión transparente</span>
            </li>
          </ul>
        </div>
      </aside>

      {/* ================================================================
          COLUMNA DERECHA — Formulario de acceso
          Desktop: 45% de ancho con fondo gris muy claro
          Mobile: ocupa toda la pantalla con header compacto arriba
          ================================================================ */}
      <main className="flex-1 flex flex-col bg-[#F7F8FA]">
        {/* Header compacto solo en mobile */}
        <div className="lg:hidden pt-8 pb-4 px-6 flex flex-col items-center bg-white border-b border-slate-100">
          <Image
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            width={100}
            height={100}
            className="h-20 w-auto mb-2"
            priority
          />
        </div>

        {/* Contenedor del form, centrado vertical en desktop */}
        <div className="flex-1 flex items-center justify-center px-6 sm:px-8 py-10 sm:py-14">
          <div className="w-full max-w-[460px]">
            {/* Encabezado */}
            <div className="mb-8 text-center lg:text-left">
              <p
                className="text-xs font-semibold uppercase tracking-[0.14em] mb-2"
                style={{ color: "#1e3a8a" }}
              >
                Tesorería CPCC
              </p>
              <h2
                className="text-2xl sm:text-3xl font-semibold tracking-tight"
                id="login-title"
                style={{ color: "#0f172a" }}
              >
                Bienvenido
              </h2>
              <p className="text-sm text-slate-500 mt-1.5" id="login-subtitle">
                Ingresa a tu cuenta para continuar.
              </p>
            </div>

            {/* Error desde URL (viene del middleware o server) */}
            {params.error && (
              <div
                role="alert"
                className="text-sm bg-red-50 text-red-800 rounded-lg p-3 mb-5 border border-red-200"
              >
                <strong>Error al iniciar sesión:</strong> {params.error}
              </div>
            )}
            {params.debug && (
              <div className="text-xs bg-amber-50 text-amber-900 rounded-lg p-3 mb-5 border border-amber-200 break-words">
                <strong>Debug:</strong> {params.debug}
              </div>
            )}

            {/* Formulario */}
            <LoginForm />

            {/* Ayuda colapsable */}
            <details className="mt-6 group">
              <summary className="cursor-pointer text-sm text-slate-600 hover:text-slate-900 flex items-center justify-between list-none select-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">
                    ¿Primera vez en Tesorería CPCC?
                  </span>
                  <span className="text-slate-500">Ver cómo ingresar</span>
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
              <div className="mt-3 rounded-lg bg-white border border-slate-200 p-4 text-sm text-slate-600 space-y-4">
                <div>
                  <div
                    className="font-semibold mb-1.5"
                    style={{ color: "#1e3a8a" }}
                  >
                    Primera vez
                  </div>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>
                      Selecciona <strong>&quot;Crear cuenta&quot;</strong>.
                    </li>
                    <li>Ingresa tu correo electrónico.</li>
                    <li>Define tu contraseña (mínimo 8 caracteres).</li>
                    <li>
                      Tu cuenta quedará inicialmente como{" "}
                      <strong>Apoderado</strong>.
                    </li>
                  </ol>
                </div>
                <div className="pt-3 border-t border-slate-100">
                  <div
                    className="font-semibold mb-1.5"
                    style={{ color: "#1e3a8a" }}
                  >
                    ¿Olvidaste tu contraseña?
                  </div>
                  <p>
                    Contacta a alguien de la directiva para que restablezca
                    tu contraseña. Por seguridad no hay restablecimiento
                    automático por correo.
                  </p>
                </div>
              </div>
            </details>

            {/* Mensaje de confianza */}
            <p className="mt-6 text-xs text-slate-500 text-center flex items-center justify-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Acceso exclusivo para la comunidad del Colegio Carampangue.
            </p>
          </div>
        </div>

        {/* Footer con ACTYON */}
        <footer className="px-6 sm:px-8 py-5 border-t border-slate-200 bg-white">
          <div className="max-w-[460px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div className="text-center sm:text-left">
              © {anio} Centro de Padres Colegio Carampangue
            </div>
            <div className="flex items-center gap-2">
              <span>Desarrollado por</span>
              <Image
                src="/actyon.png"
                alt="Actyon Ingeniería"
                width={100}
                height={28}
                className="h-5 w-auto object-contain"
              />
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
