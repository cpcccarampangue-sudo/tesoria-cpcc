import { requireDirectiva } from "@/lib/auth";
import { ReportesClient } from "./reportes-client";

export const metadata = { title: "Reportes — Tesorería CPCC" };

export default async function ReportesPage() {
  await requireDirectiva();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Reportes</h1>
        <p className="text-sm text-slate-600">
          Descarga reportes para tu archivo o para presentar en las reuniones
          de directiva.
        </p>
      </div>
      <ReportesClient />
    </div>
  );
}
