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
  type FamiliaCandidata,
  type ResultadoBusqueda,
} from "./tipos";

type Paso =
  | { nombre: "buscar" }
  | { nombre: "elegir"; resultado: ResultadoBusqueda; consulta: string }
  | { nombre: "confirmar"; familia: FamiliaCandidata }
  | { nombre: "ya_socio"; familia: FamiliaCandidata; qrToken: string }
  | { nombre: "manual"; consulta: string };

// Server actions con redirect(...) lanzan un error especial de Next.js
// con digest "NEXT_REDIRECT". No debemos tratarlo como error de usuario.
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

  function manejarBusqueda(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const resultado = await buscarFamilias(consulta);
        // Estado explicito NOT_FOUND: el servidor consulto exitosamente
        // y confirmo que el correo no esta en la base. Recien aqui
        // ofrecemos el flujo manual. Si el servidor tira (error de red,
        // db, rate limit) caemos al catch y mostramos el mensaje real:
        // NO asumimos "no encontrado" cuando en realidad fue "no sabemos".
        if (resultado.familias.length === 0) {
          setPaso({ nombre: "manual", consulta });
          setManual((m) => ({ ...m, apoderado_email: consulta.trim() }));
          setHijos([{ nombre: "", curso: "" }]);
          return;
        }
        if (resultado.familias.length === 1) {
          elegirFamilia(resultado.familias[0]);
          return;
        }
        setPaso({ nombre: "elegir", resultado, consulta });
      } catch (err) {
        const raw = err instanceof Error ? err.message : "";
        // Mensajes "db:*" vienen del server cuando falla una query y
        // no son amigables; los reemplazamos por uno generico. El resto
        // (validacion de formato, rate limit) ya es amigable.
        const esDbError = raw.startsWith("db:");
        setError(
          esDbError
            ? "No pudimos verificar tus datos en este momento. Inténtalo nuevamente en unos minutos."
            : raw || "Error inesperado."
        );
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
    // Pre-llenamos el email con el correo que uso para buscar: ya es suyo.
    setEmail(consulta.trim());
  }

  function confirmarPago(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (paso.nombre !== "confirmar") return;
    // Usar siempre TODOS los hijos activos: cuota es por familia.
    const todosLosHijosIds = paso.familia.estudiantes.map((e) => e.id);
    startTransition(async () => {
      try {
        await crearSolicitudSocio({
          apoderado_id: paso.familia.apoderadoId,
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
      <form onSubmit={manejarBusqueda} className="space-y-5">
        <div>
          <label
            htmlFor="busqueda-correo"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Correo electrónico registrado
          </label>
          <input
            id="busqueda-correo"
            type="email"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
            inputMode="email"
          />
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Usa el correo con que te registraste en el colegio. Si no coincide
            con nuestros registros, podrás continuar con un formulario de
            incorporación manual.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          disabled={pending}
        >
          {pending ? "Buscando…" : "Continuar"}
        </button>

        <p className="text-xs text-slate-500 text-center leading-relaxed">
          Por protección de datos, el formulario público no permite buscar
          por nombre, apellido o alumno.
        </p>
      </form>
    );
  }

  if (paso.nombre === "elegir") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
          Encontramos <strong>{paso.resultado.familias.length}</strong>{" "}
          familia(s) asociadas a este correo. Selecciona la tuya.
        </div>

        <div className="space-y-2">
          {paso.resultado.familias.map((f) => (
            <button
              key={f.apoderadoId}
              type="button"
              className="w-full text-left p-3.5 border border-slate-200 rounded-xl hover:border-brand-500 hover:bg-brand-50 transition-colors"
              onClick={() => elegirFamilia(f)}
            >
              <div className="font-medium text-slate-900">
                {f.apoderadoNombreMask}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {f.estudiantes.length === 0 ? (
                  <em>sin alumnos activos</em>
                ) : (
                  f.estudiantes
                    .map(
                      (e) =>
                        `${e.nombreMask}${e.curso ? ` · ${e.curso}` : ""}`
                    )
                    .join(" · ")
                )}
              </div>
              {f.contactosMask.length > 0 && (
                <div className="text-xs text-slate-400 mt-1">
                  Contactos: {f.contactosMask.map((c) => c.emailMask).join(", ")}
                </div>
              )}
            </button>
          ))}
        </div>

        {paso.resultado.hayMas && (
          <div className="text-xs text-amber-700">
            Hay más coincidencias. Si no reconoces tu familia, verifica el
            correo que ingresaste.
          </div>
        )}

        <button
          type="button"
          className="w-full h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          onClick={() => setPaso({ nombre: "buscar" })}
        >
          Volver
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
        <div className="rounded-2xl bg-green-50 border border-green-200 p-5 text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <svg
              className="w-7 h-7 text-green-700"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div className="text-lg font-semibold text-green-900">
            Ya figura como socio activo
          </div>
          <p className="text-sm text-green-800">
            La familia <strong>{paso.familia.apoderadoNombreMask}</strong>{" "}
            tiene su cuota al día para el período vigente. No necesitas pagar
            de nuevo.
          </p>
        </div>

        <a
          href={urlPublica}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-[54px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-colors flex items-center justify-center"
        >
          Ver mi QR de socio
        </a>

        <p className="text-xs text-slate-500 text-center">
          Si quieres recibir el QR por correo, contacta a la tesorería del
          Centro de Padres.
        </p>

        <button
          type="button"
          className="w-full h-[48px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          onClick={() => {
            setPaso({ nombre: "buscar" });
            setConsulta("");
          }}
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  if (paso.nombre === "confirmar") {
    const familia = paso.familia;
    const totalHijos = familia.estudiantes.length;
    return (
      <form onSubmit={confirmarPago} className="space-y-4">
        <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-900">
          <strong>¡Te encontramos!</strong> Confirma los datos de tu familia
          antes de continuar al pago.
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Familia
          </label>
          <div className="w-full h-[52px] px-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 flex items-center">
            {familia.apoderadoNombreMask}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Mostramos los datos parcialmente para proteger la información
            de las familias.
          </p>
        </div>

        {familia.estudiantes.length === 0 ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            No encontramos alumnos activos en tu familia. Contacta a la
            tesorería para completar los datos antes de incorporarte como
            socio.
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Hijos cubiertos por este QR
            </label>
            <p className="text-xs text-slate-500 mb-2">
              La cuota es por familia; el QR cubre a todos tus hijos
              matriculados.
            </p>
            <ul className="space-y-1.5">
              {familia.estudiantes.map((est) => (
                <li
                  key={est.id}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50"
                >
                  <div className="font-medium text-sm text-slate-900">
                    {est.nombreMask}
                  </div>
                  <div className="text-xs text-slate-500">
                    {est.curso ?? "— sin curso —"}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label
            htmlFor="confirmar-email"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Correo donde recibir el QR
          </label>
          <input
            id="confirmar-email"
            type="email"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
            inputMode="email"
          />
        </div>

        <div>
          <label
            htmlFor="confirmar-tel"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Teléfono{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            id="confirmar-tel"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+56 9 1234 5678"
            autoComplete="tel"
            inputMode="tel"
          />
        </div>

        <div className="rounded-xl bg-brand-50 border border-brand-200 p-4">
          <div className="text-xs text-slate-600 uppercase tracking-wider font-medium">
            Monto a pagar
          </div>
          <div className="text-2xl font-semibold text-brand-900 mt-0.5">
            ${config.monto_cuota.toLocaleString("es-CL")} CLP
          </div>
          <div className="text-xs text-slate-600 mt-1">
            Cuota socio {config.periodo_anio} — cubre {totalHijos} hijo
            {totalHijos !== 1 ? "s" : ""}.
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
          >
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
            onClick={() => setPaso({ nombre: "buscar" })}
          >
            Volver
          </button>
          <button
            type="submit"
            className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
            disabled={pending || totalHijos === 0}
          >
            {pending ? "Procesando…" : "Confirmar y pagar"}
          </button>
        </div>
      </form>
    );
  }

  // paso.nombre === "manual"
  return (
    <form onSubmit={enviarManual} className="space-y-4">
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
        No pudimos vincular tu correo con una familia registrada. Completa
        tus datos y la directiva verificará y vinculará tu solicitud antes
        de confirmar la membresía.
      </div>

      <div>
        <label
          htmlFor="m-nombre"
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          Nombre del apoderado
        </label>
        <input
          id="m-nombre"
          className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
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
          <label
            htmlFor="m-email"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            Correo electrónico
          </label>
          <input
            id="m-email"
            type="email"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={manual.apoderado_email}
            onChange={(e) =>
              setManual((m) => ({ ...m, apoderado_email: e.target.value }))
            }
            placeholder="correo@ejemplo.cl"
            required
            autoComplete="email"
            inputMode="email"
          />
        </div>
        <div>
          <label
            htmlFor="m-rut"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            RUT{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            id="m-rut"
            className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
            value={manual.apoderado_rut}
            onChange={(e) =>
              setManual((m) => ({ ...m, apoderado_rut: e.target.value }))
            }
            placeholder="12.345.678-9"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="m-tel"
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          Teléfono{" "}
          <span className="text-xs text-slate-500 font-normal">
            (opcional)
          </span>
        </label>
        <input
          id="m-tel"
          className="w-full h-[52px] px-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
          value={manual.apoderado_telefono}
          onChange={(e) =>
            setManual((m) => ({ ...m, apoderado_telefono: e.target.value }))
          }
          placeholder="+56 9 1234 5678"
          autoComplete="tel"
          inputMode="tel"
        />
      </div>

      <div className="border-t border-slate-200 pt-4 mt-5">
        <h3 className="font-medium text-slate-800">
          Datos de los alumnos
        </h3>
        <p className="text-xs text-slate-500 mb-3 mt-1">
          Puedes agregar varios hijos. Nos ayuda a identificar correctamente
          tu familia.
        </p>
        <div className="space-y-2.5">
          {hijos.map((h, i) => (
            <div
              key={i}
              className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/60"
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
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nombre del alumno
                  </label>
                  <input
                    className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 shadow-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    value={h.nombre}
                    onChange={(e) =>
                      actualizarHijo(i, { nombre: e.target.value })
                    }
                    placeholder="Ej: Juan Pérez"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Curso
                  </label>
                  <select
                    className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 shadow-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
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
          className="text-sm text-brand-700 hover:underline mt-2.5"
          onClick={agregarHijo}
        >
          + Agregar otro hijo
        </button>
      </div>

      <div className="rounded-xl bg-brand-50 border border-brand-200 p-4">
        <div className="text-xs text-slate-600 uppercase tracking-wider font-medium">
          Monto a pagar
        </div>
        <div className="text-2xl font-semibold text-brand-900 mt-0.5">
          ${config.monto_cuota.toLocaleString("es-CL")} CLP
        </div>
        <div className="text-xs text-slate-600 mt-1">
          Cuota socio {config.periodo_anio}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="text-sm bg-red-50 text-red-800 rounded-lg p-3 border border-red-200"
        >
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="h-[52px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium transition-colors"
          onClick={() => setPaso({ nombre: "buscar" })}
        >
          Volver
        </button>
        <button
          type="submit"
          className="flex-1 h-[52px] rounded-xl bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-2"
          disabled={pending}
        >
          {pending ? "Procesando…" : "Continuar al pago"}
        </button>
      </div>

      <p className="text-xs text-slate-500 text-center leading-relaxed">
        Tu solicitud quedará como{" "}
        <strong>pendiente de identificar</strong>. La tesorería verificará
        tus datos y la vinculará a tu familia antes de confirmar la
        membresía.
      </p>
    </form>
  );
}
