import { requireDirectiva } from "@/lib/auth";
import { SincronizarForm } from "./sincronizar-form";

export const metadata = { title: "Sincronizar desde Google Sheets" };

export default async function SincronizarPage() {
  await requireDirectiva();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          Sincronizar desde Google Sheets
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Descarga tu planilla oficial de Google Drive e importa/actualiza las
          familias, contactos, estudiantes y cuotas del período.
        </p>
      </div>

      <div className="card bg-blue-50 border border-blue-200 text-sm text-blue-900 space-y-1">
        <div className="font-semibold">Antes de sincronizar</div>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            En tu Google Sheets: <strong>Compartir</strong> →{" "}
            &quot;Cualquier persona con el enlace&quot; → <strong>Lector</strong>{" "}
            → Copiar enlace.
          </li>
          <li>
            La hoja debe llamarse <code>Socios</code> (o ser la primera). Debe
            tener al menos la columna <code>familia</code>. Detecta
            automáticamente las columnas de Padre, Madre, Alumnos, valor,
            comprobante, etc.
          </li>
          <li>
            <strong>Al sincronizar se reemplazan</strong> los contactos,
            estudiantes y pagos de cuota de las familias del sheet. Otras
            familias que estén solo en la app no se tocan.
          </li>
        </ol>
      </div>

      <div className="card">
        <SincronizarForm />
      </div>
    </div>
  );
}
