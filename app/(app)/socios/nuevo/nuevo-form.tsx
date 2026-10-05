"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SocioConfig } from "@/lib/types";
import { buscarFamilias } from "@/app/incorporacion/actions";
import type { FamiliaCandidata } from "@/app/incorporacion/tipos";
import { crearSocioConPagoManual } from "../actions";

type CuentaOp = { id: string; nombre: string; es_principal: boolean };

type Paso =
  | { nombre: "buscar" }
  | { nombre: "confirmar"; familia: FamiliaCandidata };

export function NuevoSocioForm({
  config,
  cuentas,
}: {
  config: SocioConfig;
  cuentas: CuentaOp[];
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>({ nombre: "buscar" });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<FamiliaCandidata[]>([]);
  const [hayMas, setHayMas] = useState(false);

  // Estado del paso "confirmar"
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [estudianteIds, setEstudianteIds] = useState<Set<string>>(new Set());
  const [pago, setPago] = useState({
    cuenta_id: cuentas.find((c) => c.es_principal)?.id ?? cuentas[0]?.id ?? "",
    fecha: new Date().toISOString().slice(0, 10),
    metodo: "efectivo" as "efectivo" | "transferencia" | "cheque" | "otro",
    nota: "",
    enviarQr: true,
  });

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const r = await buscarFamilias(consulta);
        setResultados(r.familias);
        setHayMas(r.hayMas);
        if (r.familias.length === 0) {
          setError(
            `No se encontró ninguna familia con "${consulta}". Si es una familia nueva, agrégala primero en /apoderados.`
          );
        } else if (r.familias.length === 1) {
          elegirFamilia(r.familias[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function elegirFamilia(f: FamiliaCandidata) {
    setPaso({ nombre: "confirmar", familia: f });
    setEstudianteIds(new Set(f.estudiantes.map((e) => e.id)));
    const emailContacto = f.contactos.find((c) => c.email)?.email ?? "";
    setEmail(emailContacto);
  }

  function toggleEstudiante(id: string) {
    setEstudianteIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (paso.nombre !== "confirmar") return;
    startTransition(async () => {
      try {
        const id = await crearSocioConPagoManual({
          apoderado_id: paso.familia.apoderado.id,
          apoderado_email: email,
          apoderado_telefono: telefono,
          estudiante_ids: Array.from(estudianteIds),
          cuenta_id: pago.cuenta_id,
          fecha: pago.fecha,
          metodo: pago.metodo,
          nota: pago.nota,
          enviarQr: pago.enviarQr,
        });
        router.push(`/socios/${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  if (paso.nombre === "buscar") {
    return (
      <div className="space-y-4">
        <form onSubmit={buscar} className="space-y-3">
          <div>
            <label className="label">Buscar familia</label>
            <input
              className="input"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="correo@ejemplo.cl · Cáceres · Alonso"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              Busca por correo del contacto o apellido de familia/alumno.
            </p>
          </div>
          <button className="btn-primary" disabled={pending}>
            {pending ? "Buscando..." : "Buscar →"}
          </button>
        </form>

        {resultados.length > 1 && (
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <p className="text-sm text-slate-600">
              {resultados.length} coincidencias · elige una:
            </p>
            {resultados.map((f) => (
              <button
                key={f.apoderado.id}
                type="button"
                className="w-full text-left p-3 border border-slate-200 rounded-md hover:border-brand-500 hover:bg-brand-50"
                onClick={() => elegirFamilia(f)}
              >
                <div className="font-medium">{f.apoderado.nombre}</div>
                <div className="text-xs text-slate-600 mt-1">
                  {f.estudiantes.length === 0 ? (
                    <em>sin alumnos activos</em>
                  ) : (
                    f.estudiantes
                      .map((e) => `${e.nombre}${e.curso ? ` (${e.curso})` : ""}`)
                      .join(" · ")
                  )}
                </div>
              </button>
            ))}
            {hayMas && (
              <p className="text-xs text-amber-700">
                Hay más de 10 resultados. Afina la búsqueda si no ves la
                familia correcta.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
            {error}
          </div>
        )}
      </div>
    );
  }

  // paso === "confirmar"
  const familia = paso.familia;
  const seleccionados = familia.estudiantes.filter((e) =>
    estudianteIds.has(e.id)
  );

  return (
    <form onSubmit={confirmar} className="space-y-4">
      <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
        <strong>Familia encontrada:</strong> {familia.apoderado.nombre}
      </div>

      {familia.estudiantes.length === 0 ? (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          Esta familia no tiene alumnos activos. Carga los hijos en{" "}
          <a
            href={`/apoderados/${familia.apoderado.id}`}
            className="underline"
          >
            /apoderados/{familia.apoderado.id.slice(0, 8)}
          </a>{" "}
          antes de incorporarla como socia.
        </div>
      ) : (
        <div>
          <label className="label">Hijos incluidos en el QR</label>
          <div className="space-y-1">
            {familia.estudiantes.map((est) => (
              <label
                key={est.id}
                className="flex items-center gap-2 p-2 rounded-md border border-slate-200 hover:border-slate-300 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={estudianteIds.has(est.id)}
                  onChange={() => toggleEstudiante(est.id)}
                />
                <div className="flex-1">
                  <div className="font-medium text-sm">{est.nombre}</div>
                  <div className="text-xs text-slate-500">
                    {est.curso ?? "— sin curso —"}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Correo del apoderado</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.cl"
            required
          />
          <p className="text-xs text-slate-500 mt-1">
            Aquí llegará el QR si marcas &quot;enviar correo&quot;.
          </p>
        </div>
        <div>
          <label className="label">
            Teléfono{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+56 9 1234 5678"
          />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3">
        <h3 className="font-medium text-slate-800 mb-2">Datos del pago</h3>
        <div className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900 mb-3">
          Monto: <strong>${config.monto_cuota.toLocaleString("es-CL")} CLP</strong>{" "}
          · Socio {config.periodo_anio}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Cuenta destino</label>
            <select
              className="input"
              value={pago.cuenta_id}
              onChange={(e) =>
                setPago((p) => ({ ...p, cuenta_id: e.target.value }))
              }
              required
            >
              {cuentas.length === 0 ? (
                <option value="">(sin cuentas activas)</option>
              ) : (
                cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.es_principal ? " (principal)" : ""}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="label">Fecha del pago</label>
            <input
              type="date"
              className="input"
              value={pago.fecha}
              onChange={(e) =>
                setPago((p) => ({ ...p, fecha: e.target.value }))
              }
              required
            />
          </div>
          <div>
            <label className="label">Medio</label>
            <select
              className="input"
              value={pago.metodo}
              onChange={(e) =>
                setPago((p) => ({
                  ...p,
                  metodo: e.target.value as typeof pago.metodo,
                }))
              }
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className="label">
              Nota{" "}
              <span className="text-xs text-slate-500 font-normal">
                (opcional)
              </span>
            </label>
            <input
              className="input"
              value={pago.nota}
              onChange={(e) => setPago((p) => ({ ...p, nota: e.target.value }))}
              placeholder="Ej. reunión del 05/oct"
            />
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm pt-2 border-t border-slate-200">
        <input
          type="checkbox"
          checked={pago.enviarQr}
          onChange={(e) =>
            setPago((p) => ({ ...p, enviarQr: e.target.checked }))
          }
        />
        <span>Enviar QR al correo del apoderado inmediatamente</span>
      </label>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setPaso({ nombre: "buscar" })}
          disabled={pending}
        >
          ← Volver a buscar
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={pending || seleccionados.length === 0}
        >
          {pending ? "Procesando..." : "✓ Incorporar socio + registrar pago"}
        </button>
      </div>

      <p className="text-xs text-slate-500 pt-2">
        Al confirmar: se crea solicitud en estado &quot;pagada&quot;, se
        registra movimiento ingreso en el libro de caja y la familia queda
        marcada como socia activa del {config.periodo_anio}.
      </p>
    </form>
  );
}
