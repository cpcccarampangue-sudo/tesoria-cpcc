import { requireDirectiva } from "@/lib/auth";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importar apoderados — Tesorería CPCC" };

const CSV_EJEMPLO = `nombre,email,telefono,estudiantes
María Pérez,maria.perez@ejemplo.cl,+56 9 1234 5678,Juan Pérez:5°B; Sofía Pérez:3°A
Carlos Soto,,,Ana Soto:K
Ana Rojas,ana.rojas@ejemplo.cl,,`;

export default async function ImportarApoderadosPage() {
  await requireDirectiva();
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Importar apoderados desde CSV</h1>
        <p className="text-sm text-slate-600 mt-1">
          Pega el contenido de tu planilla en el cuadro de abajo. La primera
          fila debe tener los encabezados. Si un apoderado ya existe con el
          mismo email, se actualizará; si no, se creará.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Columnas esperadas</h2>
        <ul className="text-sm text-slate-600 list-disc pl-5 space-y-1">
          <li>
            <code>nombre</code> — obligatorio (nombre del apoderado)
          </li>
          <li>
            <code>email</code> — recomendado (se usa para vincular la cuenta
            cuando el apoderado ingrese)
          </li>
          <li>
            <code>telefono</code> — opcional
          </li>
          <li>
            <code>estudiantes</code> — opcional. Formato:{" "}
            <code>Nombre1:Curso1; Nombre2:Curso2</code>. Separa hijos con{" "}
            <code>;</code> y usa <code>:</code> entre nombre y curso. Ejemplo:{" "}
            <code>Juan Pérez:5°B; Sofía Pérez:3°A</code>.
          </li>
        </ul>
        <div className="mt-3">
          <div className="text-xs text-slate-500 mb-1">
            Ejemplo (haz clic para copiar):
          </div>
          <CopyableExample sample={CSV_EJEMPLO} />
        </div>
      </div>

      <div className="card">
        <ImportForm />
      </div>
    </div>
  );
}

function CopyableExample({ sample }: { sample: string }) {
  return (
    <pre className="text-xs bg-slate-900 text-slate-100 rounded-md p-3 overflow-x-auto whitespace-pre">
      {sample}
    </pre>
  );
}
