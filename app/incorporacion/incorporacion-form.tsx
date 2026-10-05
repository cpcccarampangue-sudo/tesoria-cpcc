"use client";

import { useState, useTransition } from "react";
import type { SocioConfig } from "@/lib/types";
import {
  buscarFamiliaPorEmail,
  crearSolicitudSocio,
  type FamiliaIdentificada,
} from "./actions";

type Paso = "identificar" | "confirmar";

export function IncorporacionForm({ config }: { config: SocioConfig }) {
  const [pending, startTransition] = useTransition();
  const [paso, setPaso] = useState<Paso>("identificar");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [familia, setFamilia] = useState<FamiliaIdentificada | null>(null);
  const [estudianteIds, setEstudianteIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function buscarFamilia(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const encontrada = await buscarFamiliaPorEmail(email);
        if (!encontrada) {
          setError(
            "No encontramos tu correo en el listado del colegio. Si eres apoderado matriculado, contacta a la tesorería para que corrijan tus datos."
          );
          return;
        }
        if (encontrada.estudiantes.length === 0) {
          setError(
            "Tu familia está registrada pero no tiene alumnos activos en el sistema. Contacta a la directiva para completar los datos."
          );
          return;
        }
        setFamilia(encontrada);
        // Pre-seleccionar todos los hijos activos
        setEstudianteIds(new Set(encontrada.estudiantes.map((e) => e.id)));
        setPaso("confirmar");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
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
    if (!familia) return;
    startTransition(async () => {
      try {
        await crearSolicitudSocio({
          apoderado_id: familia.apoderado.id,
          apoderado_email: email,
          apoderado_telefono: telefono,
          estudiante_ids: Array.from(estudianteIds),
        });
      } catch (err) {
        if (
          err instanceof Error &&
          "digest" in err &&
          String((err as { digest?: string }).digest).startsWith(
            "NEXT_REDIRECT"
          )
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  if (paso === "identificar") {
    return (
      <form onSubmit={buscarFamilia} className="space-y-3">
        <div>
          <label className="label">Correo electrónico del apoderado</label>
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
            Usa el mismo correo que registraste en matrícula. Buscamos tu
            familia en el listado del colegio.
          </p>
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
          ¿No sabes qué correo tenemos registrado? Escribe a la tesorería
          para que te lo indiquemos.
        </p>
      </form>
    );
  }

  // paso === "confirmar"
  if (!familia) return null;
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

      <div>
        <label className="label">¿Qué hijos quieres incluir en el QR?</label>
        <p className="text-xs text-slate-500 mb-2">
          Por defecto están todos marcados. La cuota es por familia, da lo
          mismo cuántos hijos tengas.
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

      <div>
        <label className="label">
          Teléfono de contacto{" "}
          <span className="text-xs text-slate-500 font-normal">(opcional)</span>
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
          onClick={() => {
            setPaso("identificar");
            setFamilia(null);
            setError(null);
          }}
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

      <p className="text-xs text-slate-500 text-center pt-2">
        Al continuar aceptas que el Centro de Padres guarde tus datos para
        emitir tu condición de socio.
      </p>
    </form>
  );
}
