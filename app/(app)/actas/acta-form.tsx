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

type Direccion = "egreso" | "ingreso";
type Medio = "efectivo" | "transferencia" | "cheque";

export function ActaForm({
  cargosActivos,
}: {
  cargosActivos: DirectivaCargo[];
}) {
  const [direccion, setDireccion] = useState<Direccion>("egreso");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fecha, setFecha] = useState(todayISO());
  const [personaNombre, setPersonaNombre] = useState("");
  const [personaRut, setPersonaRut] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [medio, setMedio] = useState<Medio>("efectivo");
  const [firmantes, setFirmantes] = useState<Set<DirectivaCargo>>(
    new Set(["tesorero"])
  );
  const [error, setError] = useState<string | null>(null);

  const acompanantes = CARGOS_ACOMPANANTES.filter((c) =>
    cargosActivos.includes(c)
  );

  const montoNum = parseCLPInput(monto);

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
    if (!montoNum || montoNum <= 0) {
      setError("Ingresa un monto mayor a 0.");
      return;
    }
    if (!concepto.trim()) {
      setError("El concepto es obligatorio.");
      return;
    }
    if (!firmantes.has("tesorero")) {
      setError("La firma del tesorero/a es obligatoria.");
      return;
    }

    const params = new URLSearchParams();
    params.set("direccion", direccion);
    params.set("monto", String(montoNum));
    params.set("concepto", concepto.trim());
    params.set("fecha", fecha);
    if (personaNombre.trim()) params.set("persona_nombre", personaNombre.trim());
    if (personaRut.trim()) params.set("persona_rut", personaRut.trim());
    if (ciudad.trim()) params.set("ciudad", ciudad.trim());
    params.set("medio", medio);
    params.set(
      "firmantes",
      Array.from(firmantes).join(",")
    );

    const url = `/imprimir/actas?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <form onSubmit={handleGenerar} className="space-y-4">
      <div>
        <label className="label">Tipo de acta</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            className={`border rounded-md p-3 cursor-pointer text-sm ${
              direccion === "egreso"
                ? "border-brand-600 bg-brand-50"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="direccion"
              value="egreso"
              checked={direccion === "egreso"}
              onChange={() => setDireccion("egreso")}
              className="mr-2"
            />
            <span className="font-medium">El CdP entrega plata</span>
            <div className="text-xs text-slate-600 mt-1">
              Alguien recibe plata del CdP y firma constancia (pago, premio,
              reembolso).
            </div>
          </label>
          <label
            className={`border rounded-md p-3 cursor-pointer text-sm ${
              direccion === "ingreso"
                ? "border-brand-600 bg-brand-50"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="direccion"
              value="ingreso"
              checked={direccion === "ingreso"}
              onChange={() => setDireccion("ingreso")}
              className="mr-2"
            />
            <span className="font-medium">El CdP recibe plata</span>
            <div className="text-xs text-slate-600 mt-1">
              El CdP declara haber recibido plata de alguien (aporte,
              donación, cobro en efectivo).
            </div>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Fecha</label>
          <input
            type="date"
            className="input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Monto (CLP)</label>
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
        <label className="label">Concepto</label>
        <input
          className="input"
          value={concepto}
          onChange={(e) => setConcepto(e.target.value)}
          placeholder="Ej: pago proveedor de globos para Fiesta 2026"
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">
            {direccion === "egreso" ? "Persona que recibe" : "Persona que entrega"}{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={personaNombre}
            onChange={(e) => setPersonaNombre(e.target.value)}
            placeholder="Nombre y apellido"
          />
          <p className="text-xs text-slate-500 mt-1">
            Si lo dejas en blanco, queda una línea para llenar a mano.
          </p>
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
          <label className="label">
            Ciudad{" "}
            <span className="text-xs text-slate-500 font-normal">
              (opcional)
            </span>
          </label>
          <input
            className="input"
            value={ciudad}
            onChange={(e) => setCiudad(e.target.value)}
            placeholder="Carampangue"
          />
          <p className="text-xs text-slate-500 mt-1">
            Si lo dejas en blanco, queda una línea para llenar a mano.
          </p>
        </div>
        <div>
          <label className="label">Medio de entrega</label>
          <select
            className="input"
            value={medio}
            onChange={(e) => setMedio(e.target.value as Medio)}
          >
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia bancaria</option>
            <option value="cheque">Cheque</option>
          </select>
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
          🧾 Generar acta
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setMonto("");
            setConcepto("");
            setPersonaNombre("");
            setPersonaRut("");
            setCiudad("");
            setError(null);
          }}
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}
