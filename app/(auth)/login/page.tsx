import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar — Tesorería CPCC" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-slate-900">
            Tesorería CPCC
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Centro de Padres — sistema de cuentas
          </p>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Ingresar</h2>
          <p className="text-sm text-slate-600 mb-4">
            Escribe tu correo y te enviaremos un enlace para entrar. No
            necesitas contraseña.
          </p>
          {params.error && (
            <div className="text-sm bg-red-50 text-red-800 rounded-md p-3 mb-4">
              <strong>Error al iniciar sesión:</strong> {params.error}
            </div>
          )}
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
