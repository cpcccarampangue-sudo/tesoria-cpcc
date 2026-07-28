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
      </div>
    </div>
  );
}
