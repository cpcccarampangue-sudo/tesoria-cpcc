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
  | { nombre: "ya_socio"; familia: FamiliaCandidata; qrToken: string }
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

  // Estado del paso "manual"
  const [manual, setManual] = useState({
    apoderado_nombre: "",
    apoderado_email: "",
    apoderado_rut: "",
    apoderado_telefono: "",
  });
  const [hijos, setHijos] = useState<Array<{ nombre: string; curso: string }>>([
    { nombre: "", curso: "" },
  ]);

  function hintTipo(input: string) {
    if (!input.trim()) return "Ingresa tu correo electrónico registrado.";
    const t = detectarTipoBusqueda(input);
    if (t === "email") return "Buscando por correo…";
    return "Debe ser un correo electrónico válido.";
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
          // Reset de hijos al llegar al flujo manual
          setHijos([{ nombre: "", curso: "" }]);
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
    // Si la familia ya es socia activa del periodo, mostrar la tarjeta
    // verde con el QR directo en vez del formulario de pago.
    if (familia.yaSocioToken) {
      setPaso({
        nombre: "ya_socio",
        familia,
        qrToken: familia.yaSocioToken,
      });
      return;
    }
    setPaso({ nombre: "confirmar", familia });
    // Pre-llenar email con uno de los contactos (el primero que tenga email).
    const emailContacto = familia.contactos.find((c) => c.email)?.email ?? "";
    setEmail(emailContacto);
  }

  function confirmarPago(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (paso.nombre !== "confirmar") return;
    // Usar siempre TODOS los hijos activos de la familia (la cuota es por
    // familia, no por hijo). El checkbox desaparecio para simplificar.
    const todosLosHijosIds = paso.familia.estudiantes.map((e) => e.id);
    startTransition(async () => {
      try {
        await crearSolicitudSocio({
          apoderado_id: paso.familia.apoderado.id,
          apoderado_email: email,
          apoderado_telefono: telefono,
          estudiante_ids: todosLosHijosIds,
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
        await crearSolicitudManualSocio({
          ...manual,
          hijos,
        });
      } catch (err) {
        if (esRedirect(err)) return;
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  function actualizarHijo(
    i: number,
    patch: Partial<{ nombre: string; curso: string }>
  ) {
    setHijos((cur) =>
      cur.map((h, idx) => (idx === i ? { ...h, ...patch } : h))
    );
  }
  function agregarHijo() {
    setHijos((cur) => [...cur, { nombre: "", curso: "" }]);
  }
  function quitarHijo(i: number) {
    setHijos((cur) => (cur.length <= 1 ? cur : cur.filter((_, idx) => idx !== i)));
  }

  // === RENDER ===

  if (paso.nombre === "buscar") {
    return (
      <form onSubmit={manejarBusqueda} className="space-y-3">
        <div>
          <label className="label">Encuentra tu familia</label>
          <input
            type="email"
            className="input"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
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
          Usa el correo electrónico que tienes registrado en matrícula. Por
          seguridad de las familias, el formulario público no permite
          buscar por apellido o nombre del alumno. Si no sabes qué correo
          está registrado, usa la opción manual.
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

  if (paso.nombre === "ya_socio") {
    const siteUrl =
      typeof window !== "undefined" ? window.location.origin : "";
    const urlPublica = `${siteUrl}/socio/${paso.qrToken}`;
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 border-2 border-green-500 p-4 text-center space-y-2">
          <div className="text-5xl">✅</div>
          <div className="text-lg font-bold text-green-900">
            Ya eres socio activo
          </div>
          <p className="text-sm text-green-800">
            La familia <strong>{paso.familia.apoderado.nombre}</strong> ya
            figura como socia activa del período vigente. No necesitas
            pagar de nuevo.
          </p>
        </div>

        <a
          href={urlPublica}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full text-center"
        >
          Ver mi QR de socio →
        </a>

        <div className="text-xs text-slate-500 text-center">
          <p>
            Si quieres el QR en tu correo, contacta a la tesorería del CdP
            para que te lo reenvíe.
          </p>
        </div>

        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => {
            setPaso({ nombre: "buscar" });
            setConsulta("");
          }}
        >
          ← Volver
        </button>
      </div>
    );
  }

  if (paso.nombre === "confirmar") {
    const familia = paso.familia;
    const totalHijos = familia.estudiantes.length;
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
            <label className="label">Hijos que quedarán en el QR</label>
            <p className="text-xs text-slate-500 mb-2">
              La cuota es por familia; el QR cubre a todos tus hijos
              matriculados.
            </p>
            <ul className="space-y-1">
              {familia.estudiantes.map((est) => (
                <li
                  key={est.id}
                  className="p-2 rounded-md border border-slate-200 bg-slate-50"
                >
                  <div className="font-medium text-sm">{est.nombre}</div>
                  <div className="text-xs text-slate-500">
                    {est.curso ?? "— sin curso —"}
                  </div>
                </li>
              ))}
            </ul>
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
            Cubre {totalHijos} hijo
            {totalHijos !== 1 ? "s" : ""} de la familia{" "}
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
            disabled={pending || totalHijos === 0}
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
        <h3 className="font-medium text-slate-800 mb-1">
          Datos de los alumnos
        </h3>
        <p className="text-xs text-slate-500 mb-2">
          Puedes agregar varios hijos. Esto nos ayuda a identificar
          correctamente a tu familia cuando la crucemos con el listado del
          colegio.
        </p>
        <div className="space-y-2">
          {hijos.map((h, i) => (
            <div
              key={i}
              className="border border-slate-200 rounded-md p-2 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">
                  Hijo {i + 1}
                </span>
                {hijos.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => quitarHijo(i)}
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="label text-xs">Nombre del alumno</label>
                  <input
                    className="input"
                    value={h.nombre}
                    onChange={(e) =>
                      actualizarHijo(i, { nombre: e.target.value })
                    }
                    placeholder="Ej: Juan Pérez"
                    required
                  />
                </div>
                <div>
                  <label className="label text-xs">Curso</label>
                  <select
                    className="input"
                    value={h.curso}
                    onChange={(e) =>
                      actualizarHijo(i, { curso: e.target.value })
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
          ))}
        </div>
        <button
          type="button"
          className="text-sm text-brand-700 hover:underline mt-2"
          onClick={agregarHijo}
        >
          + Agregar otro hijo
        </button>
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
