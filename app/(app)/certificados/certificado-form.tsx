"use client";

import { useState } from "react";
import {
  DIRECTIVA_CARGO_LABEL,
  type DirectivaCargo,
} from "@/lib/types";
import {
  formatCLP,
  formatNumber,
  parseCLPInput,
  todayISO,
} from "@/lib/formatters";

// Cargos que tiene sentido ofrecer como acompanantes del tesorero.
const CARGOS_ACOMPANANTES: DirectivaCargo[] = [
  "presidente",
  "vicepresidente",
  "secretario",
];

type PlantillaId =
  | "blanco"
  | "pago_cuotas"
  | "socio"
  | "donacion"
  | "directiva";

type Plantilla = {
  id: PlantillaId;
  label: string;
  subtitulo: string;
  cuerpo: string;
};

const PLANTILLAS: Plantilla[] = [
  {
    id: "blanco",
    label: "En blanco",
    subtitulo: "",
    cuerpo: "",
  },
  {
    id: "pago_cuotas",
    label: "Pago de cuotas",
    subtitulo: "de pago de cuotas",
    cuerpo:
      "El {{institucion}} del Colegio Carampangue certifica que {{nombre}}, cédula de identidad N° {{rut}}, se encuentra al día con el pago de la(s) cuota(s) del periodo correspondiente, por un monto total de {{monto}}.\n\nSe extiende el presente certificado con fecha {{fecha}}, a solicitud del interesado, para los fines que estime convenientes.",
  },
  {
    id: "socio",
    label: "Socio del CdP",
    subtitulo: "de socio activo",
    cuerpo:
      "El {{institucion}} del Colegio Carampangue certifica que la familia {{nombre}} es socia activa del Centro de Padres durante el presente periodo escolar, encontrándose al día con sus obligaciones.\n\nSe extiende el presente certificado con fecha {{fecha}}, a solicitud del interesado.",
  },
  {
    id: "donacion",
    label: "Donación / aporte",
    subtitulo: "de donación",
    cuerpo:
      "El {{institucion}} del Colegio Carampangue certifica y agradece a {{nombre}}, RUT {{rut}}, por su generosa donación por un monto de {{monto}} con fecha {{fecha}}, aporte que ha contribuido al desarrollo de las actividades del Centro de Padres.\n\nSe extiende el presente certificado como constancia formal y agradecimiento.",
  },
  {
    id: "directiva",
    label: "Cargo en directiva",
    subtitulo: "de cargo en directiva",
    cuerpo:
      "El {{institucion}} del Colegio Carampangue certifica que {{nombre}}, cédula de identidad N° {{rut}}, forma parte de la directiva vigente del Centro de Padres durante el presente periodo, ejerciendo funciones oficiales del cargo asignado.\n\nSe extiende el presente certificado con fecha {{fecha}}, para los trámites que sean necesarios.",
  },
];

export function CertificadoForm({
  cargosActivos,
}: {
  cargosActivos: DirectivaCargo[];
}) {
  const [plantillaId, setPlantillaId] = useState<PlantillaId>("blanco");
  const [titulo, setTitulo] = useState("CERTIFICADO");
  const [subtitulo, setSubtitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [personaNombre, setPersonaNombre] = useState("");
  const [personaRut, setPersonaRut] = useState("");
  const [fecha, setFecha] = useState(todayISO());
  const [monto, setMonto] = useState("");
  const [firmantes, setFirmantes] = useState<Set<DirectivaCargo>>(
    new Set(["tesorero"])
  );
  const [error, setError] = useState<string | null>(null);

  const acompanantes = CARGOS_ACOMPANANTES.filter((c) =>
    cargosActivos.includes(c)
  );

  const montoNum = parseCLPInput(monto);

  function aplicarPlantilla(id: PlantillaId) {
    setPlantillaId(id);
    const p = PLANTILLAS.find((x) => x.id === id);
    if (!p) return;
    setSubtitulo(p.subtitulo);
    setCuerpo(p.cuerpo);
  }

  function toggleFirmante(cargo: DirectivaCargo) {
    setFirmantes((cur) => {
      const next = new Set(cur);
      if (next.has(cargo)) next.delete(cargo);
      else next.add(cargo);
      return next;
    });
  }

  function handleGenerar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cuerpo.trim()) {
      setError("El cuerpo del certificado no puede estar vacío.");
      return;
    }
    if (!firmantes.has("tesorero")) {
      setError("La firma del tesorero/a es obligatoria.");
      return;
    }

    const params = new URLSearchParams();
    params.set("titulo", titulo.trim() || "CERTIFICADO");
    if (subtitulo.trim()) params.set("subtitulo", subtitulo.trim());
    params.set("cuerpo", cuerpo.trim());
    params.set("fecha", fecha);
    if (personaNombre.trim()) params.set("nombre", personaNombre.trim());
    if (personaRut.trim()) params.set("rut", personaRut.trim());
    if (montoNum) params.set("monto", String(montoNum));
    params.set("firmantes", Array.from(firmantes).join(","));

    const url = `/imprimir/certificados?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <form onSubmit={handleGenerar} className="space-y-4">
      <div>
        <label className="label">Plantilla rápida</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PLANTILLAS.map((p) => (
            <label
              key={p.id}
              className={`border rounded-md p-2 cursor-pointer text-sm text-center ${
                plantillaId === p.id
                  ? "border-brand-600 bg-brand-50 font-medium"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <input
                type="radio"
                name="plantilla"
                value={p.id}
                checked={plantillaId === p.id}
                onChange={() => aplicarPlantilla(p.id)}
                className="sr-only"
              />
              {p.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Al elegir una plantilla se rellenan el subtítulo y el cuerpo. Puedes
          editarlos abajo.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Título</label>
          <input
            className="input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="CERTIFICADO"
          />
        </div>
        <div>
          <label className="label">
            Subtítulo / tipo{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={subtitulo}
            onChange={(e) => setSubtitulo(e.target.value)}
            placeholder="Ej: de pago de cuotas"
          />
        </div>
      </div>

      <div>
        <label className="label">Cuerpo del certificado</label>
        <textarea
          className="input min-h-[180px]"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          placeholder="Escribe el texto del certificado. Puedes usar {{nombre}}, {{rut}}, {{fecha}}, {{monto}}, {{institucion}} como variables que se reemplazan al imprimir."
        />
        <p className="text-xs text-slate-500 mt-1">
          Variables disponibles: <code>{"{{nombre}}"}</code>,{" "}
          <code>{"{{rut}}"}</code>, <code>{"{{fecha}}"}</code>,{" "}
          <code>{"{{monto}}"}</code>, <code>{"{{institucion}}"}</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">
            Nombre / entidad{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={personaNombre}
            onChange={(e) => setPersonaNombre(e.target.value)}
            placeholder="Nombre y apellido o razón social"
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
            value={personaRut}
            onChange={(e) => setPersonaRut(e.target.value)}
            placeholder="12.345.678-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Fecha de emisión</label>
          <input
            type="date"
            className="input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">
            Monto (CLP){" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            inputMode="numeric"
            placeholder="50000"
          />
          {montoNum !== null && (
            <div className="text-xs text-slate-500 mt-1">
              {formatCLP(montoNum)} · {formatNumber(montoNum)} pesos
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="label">Firmantes por el CdP</label>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked
              disabled
              className="opacity-60"
            />
            <span>Tesorero/a (siempre firma)</span>
          </label>
          {acompanantes.length === 0 ? (
            <p className="text-xs text-slate-500 mt-1">
              No hay otros cargos activos en la directiva. Puedes agregarlos
              en la sección <strong>Directiva</strong>.
            </p>
          ) : (
            acompanantes.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={firmantes.has(c)}
                  onChange={() => toggleFirmante(c)}
                />
                <span>{DIRECTIVA_CARGO_LABEL[c]}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-primary" type="submit">
          📄 Generar certificado
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setPlantillaId("blanco");
            setTitulo("CERTIFICADO");
            setSubtitulo("");
            setCuerpo("");
            setPersonaNombre("");
            setPersonaRut("");
            setMonto("");
            setError(null);
          }}
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}
