import { requireDirectiva } from "@/lib/auth";
import { EventoForm } from "./evento-form";

export const metadata = { title: "Nuevo evento — Tesorería CPCC" };

export default async function NuevoEventoPage() {
  await requireDirectiva();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Nuevo evento</h1>
      <div className="card">
        <EventoForm />
      </div>
    </div>
  );
}
