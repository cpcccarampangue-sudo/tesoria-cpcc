"use client";

import { useState, useTransition } from "react";
import type { CuentaTipo } from "@/lib/types";
import { crearCuenta } from "./actions";

export function NuevaCuenta() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<CuentaTipo>("banco");
  const [banco, setBanco] = useState("");
  const [titular, setTitular] = useState("");
  const [numero, setNumero] = useState("");
  const [color, setColor] = useState("#64748b");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) {
      setError("Ingresa un nombre para la cuenta.");
      return;
    }
    startTransition(async () => {
      try {
        await crearCuenta({
          nombre: nombre.trim(),
          tipo,
          banco: tipo === "banco" ? banco || null : null,
          titular: titular || null,
          numero_cuenta: numero || null,
          color,
        });
        setNombre("");
        setBanco("");
        setTitular("");
        setNumero("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error inesperado.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Banco de Chile — Cta FAN"
          />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select
            className="input"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as CuentaTipo)}
          >
            <option value="banco">Cuenta bancaria</option>
            <option value="efectivo">Caja / efectivo</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label className="label">Color</label>
          <input
            type="color"
            className="input h-[42px] p-1"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        {tipo === "banco" && (
          <div>
            <label className="label">Banco</label>
            <select
              className="input"
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
            >
              <option value="">— seleccionar —</option>
              <option value="banco_estado">Banco Estado</option>
              <option value="banco_chile">Banco de Chile</option>
              <option value="bci">BCI</option>
              <option value="santander">Santander</option>
              <option value="scotiabank">Scotiabank</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        )}
        <div>
          <label className="label">Titular (opcional)</label>
          <input
            className="input"
            value={titular}
            onChange={(e) => setTitular(e.target.value)}
            placeholder="Ej: Centro de Padres"
          />
        </div>
        <div>
          <label className="label">Número de cuenta (opcional)</label>
          <input
            className="input"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="Ej: 00-000-00000-0"
          />
        </div>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}

      <div>
        <button className="btn-primary" disabled={pending}>
          {pending ? "Guardando..." : "Agregar cuenta"}
        </button>
      </div>
    </form>
  );
}
