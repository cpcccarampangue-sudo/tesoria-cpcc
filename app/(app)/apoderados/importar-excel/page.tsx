import { requireDirectiva } from "@/lib/auth";
import { ImportExcelForm } from "./import-excel-form";

export const metadata = {
  title: "Importar Excel de familias — Tesorería CPCC",
};

export default async function ImportarExcelPage() {
  await requireDirectiva();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          Importar Excel de familias del colegio
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Herramienta específica para el archivo <code>familias 2026.xlsx</code>{" "}
          (formato con 30 columnas: familia, socio, valor, comprobante, alumno,
          padre, madre, apoderado de cuenta, apoderado académico).
        </p>
      </div>

      <div className="card bg-amber-50 border border-amber-200">
        <h2 className="font-semibold text-amber-900 mb-2">⚠️ Importante</h2>
        <ul className="text-sm text-amber-900 list-disc pl-5 space-y-1">
          <li>
            Este importador <strong>reemplaza</strong> los contactos y
            estudiantes de cada familia con lo del Excel (no fusiona).
          </li>
          <li>
            Familias identificadas por el campo <code>familia</code>{" "}
            (exacto). Si ya existe una familia con ese nombre se actualiza; si
            no, se crea.
          </li>
          <li>
            Si activas &quot;generar pagos de cuota&quot;, se crea un período de
            cuota (si no existe) y para cada familia socia con valor se registra
            el pago + un movimiento de ingreso en el libro de caja.
          </li>
          <li>
            Antes de hacer una carga masiva de producción, se recomienda hacer
            una prueba con un archivo pequeño primero.
          </li>
        </ul>
      </div>

      <div className="card">
        <ImportExcelForm />
      </div>
    </div>
  );
}
