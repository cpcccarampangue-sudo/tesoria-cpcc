import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CambiarContrasenaForm } from "./form";

export const metadata = { title: "Cambiar contraseña — Tesorería CPCC" };
export const dynamic = "force-dynamic";

export default async function CambiarContrasenaPage() {
  const profile = await requireProfile();

  // Si la persona ya cambió su contraseña temporal, no tiene sentido volver
  // a esta pantalla desde la app — la enviamos al dashboard.
  if (!profile.first_login) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            Cambia tu contraseña
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Estás usando la contraseña temporal que te dio la directiva. Elige
            una nueva antes de entrar a la app.
          </p>
        </div>
        <div className="bg-white rounded-lg shadow border border-slate-200 p-6">
          <CambiarContrasenaForm />
        </div>
        <p className="text-xs text-center text-slate-500">
          {profile.email}
        </p>
      </div>
    </div>
  );
}
