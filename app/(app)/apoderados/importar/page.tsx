import { requireDirectiva } from "@/lib/auth";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importar familias — Tesorería CPCC" };

const CSV_EJEMPLO = `nombre,contactos,estudiantes
Cáceres Pérez,Juan Cáceres:juan@correo.cl:+56912345678:padre; María Pérez:maria@correo.cl:+56987654321:madre,Juan Cáceres Pérez:5°B; Sofía Cáceres Pérez:3°A
Soto,Ana Soto:ana@correo.cl::apoderado_cuenta,Ema Soto:K
Rojas,,`;

export default async function ImportarApoderadosPage() {
  await requireDirectiva();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Importar familias desde CSV</h1>
        <p className="text-sm text-slate-600 mt-1">
          Pega tu planilla. Primera fila = encabezados. Se identifica cada
          familia por el email del primer contacto (si existe): si ya existe se
          actualiza, si no se crea nueva.
        </p>
        <p className="text-sm text-slate-600 mt-1">
          Para tu archivo <code>familias 2026.xlsx</code> hay un importador
          específico más abajo (próximamente).
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Columnas esperadas</h2>
        <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
          <li>
            <code>nombre</code> — obligatorio. Rótulo de la familia (ej.
            "Cáceres Pérez").
          </li>
          <li>
            <code>contactos</code> — opcional. Varios contactos separados por{" "}
            <code>;</code>, cada uno con 4 partes separadas por <code>:</code>:{" "}
            <code>Nombre:Email:Telefono:Relacion</code>. Relación en{" "}
            <code>padre</code>, <code>madre</code>,{" "}
            <code>apoderado_cuenta</code>, <code>apoderado_academico</code>,{" "}
            <code>otro</code>.
          </li>
          <li>
            <code>estudiantes</code> — opcional. Varios hijos separados por{" "}
            <code>;</code>, cada uno como <code>Nombre:Curso</code>. Ejemplo:{" "}
            <code>Juan Pérez:5°B; Sofía Pérez:3°A</code>.
          </li>
          <li>
            <code>socio</code> — opcional. <code>si</code>/<code>no</code>,{" "}
            <code>true</code>/<code>false</code>. Por defecto <code>si</code>.
          </li>
        </ul>
        <div className="mt-3">
          <div className="text-xs text-slate-500 mb-1">Ejemplo:</div>
          <pre className="text-xs bg-slate-900 text-slate-100 rounded-md p-3 overflow-x-auto whitespace-pre">
            {CSV_EJEMPLO}
          </pre>
        </div>
      </div>

      <div className="card">
        <ImportForm />
      </div>
    </div>
  );
}
