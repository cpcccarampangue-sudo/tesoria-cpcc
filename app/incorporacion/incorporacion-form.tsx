"use client";

import { useState, useTransition } from "react";
import type { SocioConfig } from "@/lib/types";
import { CURSO_GRUPOS, CURSO_LETRAS } from "@/lib/cursos";
import {
  buscarFamilias,
  crearSolicitudSocio,
  crearSolicitudManualSocio,
} from "./actions";
import {
  detectarTipoBusqueda,
  type FamiliaCandidata,
  type ResultadoBusqueda,
} from "./tipos";

type Paso =
  | { nombre: "buscar" }
  | { nombre: "elegir"; resultado: ResultadoBusqueda; consulta: string }
  | { nombre: "confirmar"; familia: FamiliaCandidata }
  | { nombre: "manual"; consulta: string };

function esRedirect(err: unknown): boolean {
  return (
    err instanceof Error &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function IncorporacionForm({ config }: { config: SocioConfig }) {
  const [pending, startTransition] = useTransition();
  const [paso, setPaso] = useState<Paso>({ nombre: "buscar" });
  const [error, setError] = useState<string | null>(null);
  const [consulta, setConsulta] = useState("");

  // Estado del paso "confirmar"
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [estudianteIds, setEstudianteIds] = useState<Set<string>>(new Set());

  // Estado del paso "manual"
  const [manual, setManual] = useState({
    apoderado_nombre: "",
    apoderado_email: "",
    apoderado_rut: "",
    apoderado_telefono: "",
    alumno_nombre: "",
    curso: "",
  });

  function hintTipo(input: string) {
    if (!input.trim())
      return "Correo del apoderado o apellido de la familia / alumno.";
    const t = detectarTipoBusqueda(input);
    if (t === "email") return "Buscando por correo…";
    return "Buscando por apellido…";
  }

  function manejarBusqueda(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const resultado = await buscarFamilias(consulta);
        if (resultado.familias.length === 0) {
          // No se encontro: ofrecer flujo manual con la consulta inicial.
          setPaso({ nombre: "manual", consulta });
          // Pre-llenar correo si lo que buscó es un correo; si fue un
          // nombre, lo dejamos como pista en el nombre del apoderado.
          if (resultado.tipo === "email") {
            setManual((m) => ({ ...m, apoderado_email: consulta.trim() }));
          } else {
            setManual((m) => ({ ...m, apoderado_nombre: consulta.trim() }));
          }
          return;
        }
        if (resultado.familias.length === 1) {
          // Única coincidencia: pasar directo a confirmar.
          elegirFamilia(resultado.familias[0]);
          return;
        }
        // Múltiples: pedir que elija.
        setPaso({ nombre: "elegir", resultado, consulta });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function elegirFamilia(familia: FamiliaCandidata) {
    setPaso({ nombre: "confirmar", familia });
    setEstudianteIds(new Set(familia.estudiantes.map((e) => e.id)));
    // Pre-llenar email con uno de los contactos (el primero que tenga email).
    const emailContacto = familia.contactos.find((c) => c.email)?.email ?? "";
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

  function confirmarPago(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (paso.nombre !== "confirmar") return;
    startTransition(async () => {
      try {
        await crearSolicitudSocio({
          apoderado_id: paso.familia.apoderado.id,
          apoderado_email: email,
          apoderado_telefono: telefono,
          estudiante_ids: Array.from(estudianteIds),
        });
      } catch (err) {
        if (esRedirect(err)) return;
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  function enviarManual(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await crearSolicitudManualSocio(manual);
      } catch (err) {
        if (esRedirect(err)) return;
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  // === RENDER ===

  if (paso.nombre === "buscar") {
    return (
      <form onSubmit={manejarBusqueda} className="space-y-3">
        <div>
          <label className="label">Encuentra tu familia</label>
          <input
            type="text"
            className="input"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="correo@ejemplo.cl · Cáceres · Alonso"
            required
            autoComplete="off"
          />
          <p className="text-xs text-slate-500 mt-1">{hintTipo(consulta)}</p>
        </div>

        {error && (
          <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={pending}
        >
          {pending ? "Buscando..." : "Buscar mi familia →"}
        </button>

        <p className="text-xs text-slate-500 text-center pt-2">
          Puedes buscar por correo electrónico del apoderado o por apellido
          de la familia / alumno (ej. &quot;Cáceres&quot;). Si no te
          encontramos, te daremos la opción de llenar el formulario
          manualmente.
        </p>
      </form>
    );
  }

  if (paso.nombre === "elegir") {
    return (
      <div className="space-y-3">
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
          Encontramos <strong>{paso.resultado.familias.length}</strong>{" "}
          familia(s) con &quot;{paso.consulta}&quot;. Elige la tuya:
        </div>

        <div className="space-y-2">
          {paso.resultado.familias.map((f) => (
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
              {f.contactos.some((c) => c.email) && (
                <div className="text-xs text-slate-400 mt-1">
                  Contactos:{" "}
                  {f.contactos
                    .filter((c) => c.email)
                    .map((c) => c.email)
                    .join(", ")}
                </div>
              )}
            </button>
          ))}
        </div>

        {paso.resultado.hayMas && (
          <div className="text-xs text-amber-700">
            Hay más de 10 coincidencias. Vuelve atrás y busca con un dato más
            específico (correo o RUT).
          </div>
        )}

        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => setPaso({ nombre: "buscar" })}
        >
          ← Volver a buscar
        </button>
      </div>
    );
  }

  if (paso.nombre === "confirmar") {
    const familia = paso.familia;
    const seleccionados = familia.estudiantes.filter((e) =>
      estudianteIds.has(e.id)
    );
    return (
      <form onSubmit={confirmarPago} className="space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
          <strong>¡Te encontramos!</strong> Confirma los datos de tu familia
          antes de continuar al pago.
        </div>

        <div>
          <label className="label">Familia</label>
          <div className="input bg-slate-50 cursor-not-allowed">
            {familia.apoderado.nombre}
          </div>
        </div>

        {familia.estudiantes.length === 0 ? (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            No encontramos alumnos activos en tu familia. Contacta a la
            tesorería para completar los datos antes de incorporarte como
            socio.
          </div>
        ) : (
          <div>
            <label className="label">
              ¿Qué hijos quieres incluir en el QR?
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Por defecto están todos marcados. La cuota es por familia, da
              lo mismo cuántos hijos tengas.
            </p>
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

        <div>
          <label className="label">Correo de contacto</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
          />
          <p className="text-xs text-slate-500 mt-1">
            Aquí llegará tu QR cuando confirmemos el pago.
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
            autoComplete="tel"
          />
        </div>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          <strong>Monto a pagar:</strong> $
          {config.monto_cuota.toLocaleString("es-CL")} CLP · Socio{" "}
          {config.periodo_anio}
          <div className="text-xs mt-1">
            Cubre {seleccionados.length} hijo
            {seleccionados.length !== 1 ? "s" : ""} de la familia{" "}
            {familia.apoderado.nombre}.
          </div>
        </div>

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
          >
            ← Volver
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={pending || seleccionados.length === 0}
          >
            {pending ? "Procesando..." : "Confirmar y pagar →"}
          </button>
        </div>
      </form>
    );
  }

  // paso.nombre === "manual"
  return (
    <form onSubmit={enviarManual} className="space-y-3">
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
        <strong>No encontramos tu familia</strong> con los datos
        &quot;{paso.consulta}&quot;. Llena este formulario y la directiva
        verificará tus datos antes de activar tu condición de socio.
      </div>

      <div>
        <label className="label">Nombre del apoderado</label>
        <input
          className="input"
          value={manual.apoderado_nombre}
          onChange={(e) =>
            setManual((m) => ({ ...m, apoderado_nombre: e.target.value }))
          }
          placeholder="Ej: María Pérez González"
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Correo electrónico</label>
          <input
            type="email"
            className="input"
            value={manual.apoderado_email}
            onChange={(e) =>
              setManual((m) => ({ ...m, apoderado_email: e.target.value }))
            }
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
          />
        </div>
        <div>
          <label className="label">
            RUT{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={manual.apoderado_rut}
            onChange={(e) =>
              setManual((m) => ({ ...m, apoderado_rut: e.target.value }))
            }
            placeholder="12.345.678-9"
          />
        </div>
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
          value={manual.apoderado_telefono}
          onChange={(e) =>
            setManual((m) => ({ ...m, apoderado_telefono: e.target.value }))
          }
          placeholder="+56 9 1234 5678"
          autoComplete="tel"
        />
      </div>

      <div className="border-t border-slate-200 pt-3 mt-4">
        <h3 className="font-medium text-slate-800 mb-2">Datos del alumno</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nombre del alumno</label>
            <input
              className="input"
              value={manual.alumno_nombre}
              onChange={(e) =>
                setManual((m) => ({ ...m, alumno_nombre: e.target.value }))
              }
              placeholder="Ej: Juan Pérez"
              required
            />
          </div>
          <div>
            <label className="label">Curso</label>
            <select
              className="input"
              value={manual.curso}
              onChange={(e) =>
                setManual((m) => ({ ...m, curso: e.target.value }))
              }
              required
            >
              <option value="">— seleccionar —</option>
              {CURSO_GRUPOS.map((grupo) => (
                <optgroup key={grupo.nombre} label={grupo.nombre}>
                  {grupo.niveles.flatMap((nivel) =>
                    CURSO_LETRAS.map((letra) => (
                      <option
                        key={`${nivel}-${letra}`}
                        value={`${nivel} ${letra}`}
                      >
                        {nivel} {letra}
                      </option>
                    ))
                  )}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
        <strong>Monto a pagar:</strong> $
        {config.monto_cuota.toLocaleString("es-CL")} CLP · Socio{" "}
        {config.periodo_anio}
      </div>

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
        >
          ← Volver a buscar
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={pending}
        >
          {pending ? "Procesando..." : "Continuar al pago →"}
        </button>
      </div>

      <p className="text-xs text-slate-500 text-center pt-2">
        Tu solicitud quedará marcada como <strong>pendiente de
        identificar</strong>. La tesorería verificará tus datos y vincularte
        a tu familia antes de confirmar la membresía.
      </p>
    </form>
  );
}
