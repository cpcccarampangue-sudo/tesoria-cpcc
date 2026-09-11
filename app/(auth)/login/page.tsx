import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar — Tesorería CPCC" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; debug?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Centro de Padres Colegio Carampangue"
            className="mx-auto h-24 w-auto mb-3"
          />
          <h1 className="text-xl font-semibold text-slate-900">
            Tesorería CPCC
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Colegio Carampangue — sistema de cuentas
          </p>
        </div>
        <div className="card">
          <p className="text-sm text-slate-600 mb-4">
            Ingresa con tu correo y contraseña. Si es tu primera vez, crea tu
            cuenta.
          </p>
          {params.error && (
            <div className="text-sm bg-red-50 text-red-800 rounded-md p-3 mb-4">
              <strong>Error al iniciar sesión:</strong> {params.error}
            </div>
          )}
          {params.debug && (
            <div className="text-xs bg-amber-50 text-amber-900 rounded-md p-3 mb-4 break-words">
              <strong>Debug:</strong> {params.debug}
            </div>
          )}
          <LoginForm />
        </div>

        <details className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            ¿Primera vez? Ver ayuda para ingresar
          </summary>
          <div className="mt-3 space-y-3 text-slate-600">
            <div>
              <div className="font-semibold text-slate-800">
                Si nunca has entrado
              </div>
              <ol className="list-decimal pl-5 mt-1 space-y-1">
                <li>
                  Pulsa la pestaña <strong>Crear cuenta</strong> arriba en el
                  formulario.
                </li>
                <li>
                  Ingresa tu correo electrónico y una contraseña de al menos 8
                  caracteres.
                </li>
                <li>
                  Vas a entrar como <strong>Apoderado</strong> por defecto. Si
                  corresponde, la directiva puede cambiarte el rol después.
                </li>
              </ol>
            </div>
            <div>
              <div className="font-semibold text-slate-800">
                Si ya tienes cuenta
              </div>
              <p className="mt-1">
                Ingresa tu correo y contraseña en el formulario y pulsa{" "}
                <strong>Ingresar</strong>.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-800">
                Olvidé mi contraseña
              </div>
              <p className="mt-1">
                Contacta a alguien de la directiva para que restablezca tu
                contraseña. Por seguridad no hay restablecimiento automático
                por correo.
              </p>
            </div>
            <p className="text-xs text-slate-500 pt-1 border-t border-slate-100">
              Una vez adentro, encontrarás una guía completa en el menú{" "}
              <strong>Ayuda</strong>.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
