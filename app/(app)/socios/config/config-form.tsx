"use client";

import { useState, useTransition } from "react";
import type { SocioConfig } from "@/lib/types";
import { actualizarSocioConfig } from "../actions";

export function ConfigForm({ config }: { config: SocioConfig }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    periodo_anio: String(config.periodo_anio),
    periodo_inicio: config.periodo_inicio ?? "",
    periodo_fin: config.periodo_fin ?? "",
    monto_cuota: String(config.monto_cuota),
    sumup_link: config.sumup_link ?? "",
    mensaje_bienvenida: config.mensaje_bienvenida ?? "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const periodoAnio = parseInt(form.periodo_anio, 10);
    const montoCuota = parseInt(form.monto_cuota, 10);
    if (!Number.isInteger(periodoAnio) || periodoAnio < 2020) {
      setError("Año inválido.");
      return;
    }
    if (!Number.isInteger(montoCuota) || montoCuota <= 0) {
      setError("Monto inválido.");
      return;
    }
    startTransition(async () => {
      try {
        await actualizarSocioConfig({
          periodo_anio: periodoAnio,
          periodo_inicio: form.periodo_inicio || null,
          periodo_fin: form.periodo_fin || null,
          monto_cuota: montoCuota,
          sumup_link: form.sumup_link.trim() || null,
          mensaje_bienvenida: form.mensaje_bienvenida.trim() || null,
        });
        setSuccess("Configuración guardada.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Período activo (año de la membresía)</label>
        <input
          type="number"
          className="input"
          value={form.periodo_anio}
          onChange={(e) =>
            setForm((f) => ({ ...f, periodo_anio: e.target.value }))
          }
          min={2020}
          max={2099}
          required
        />
        <p className="text-xs text-slate-500 mt-1">
          Año que figura en el QR del socio (ej.{" "}
          <strong>2027</strong> si la campaña se lanza en octubre 2026).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Inicio del período</label>
          <input
            type="date"
            className="input"
            value={form.periodo_inicio}
            onChange={(e) =>
              setForm((f) => ({ ...f, periodo_inicio: e.target.value }))
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            Desde cuándo el QR aparece como válido en el validador.
          </p>
        </div>
        <div>
          <label className="label">Fin del período</label>
          <input
            type="date"
            className="input"
            value={form.periodo_fin}
            onChange={(e) =>
              setForm((f) => ({ ...f, periodo_fin: e.target.value }))
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            Hasta cuándo el QR aparece como válido. Después aparece
            &quot;expirado&quot;.
          </p>
        </div>
      </div>

      <div>
        <label className="label">Monto de la cuota (CLP)</label>
        <input
          type="number"
          className="input"
          value={form.monto_cuota}
          onChange={(e) =>
            setForm((f) => ({ ...f, monto_cuota: e.target.value }))
          }
          min={0}
          step={100}
          required
        />
        <p className="text-xs text-slate-500 mt-1">
          Lo que debe pagar cada familia para incorporarse al período.
        </p>
      </div>

      <div>
        <label className="label">Link de pago SumUp</label>
        <input
          type="url"
          className="input"
          value={form.sumup_link}
          onChange={(e) =>
            setForm((f) => ({ ...f, sumup_link: e.target.value }))
          }
          placeholder="https://pay.sumup.com/b2c/XXXXXX"
        />
        <p className="text-xs text-slate-500 mt-1">
          Pégalo desde SumUp → Links de Pago. El link debe estar configurado
          con el monto correspondiente a la cuota.
        </p>
      </div>

      <div>
        <label className="label">
          Mensaje de bienvenida{" "}
          <span className="text-xs text-slate-500 font-normal">(opcional)</span>
        </label>
        <textarea
          className="input"
          rows={3}
          value={form.mensaje_bienvenida}
          onChange={(e) =>
            setForm((f) => ({ ...f, mensaje_bienvenida: e.target.value }))
          }
          placeholder="Ej: Ser socio del CdP te permite acceder a beneficios en comercios locales y recibir el calendario de actividades."
        />
        <p className="text-xs text-slate-500 mt-1">
          Aparece arriba del formulario público para contextualizar a los
          apoderados nuevos.
        </p>
      </div>

      {error && (
        <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm bg-green-50 text-green-800 rounded-md p-3">
          {success}
        </div>
      )}

      <button className="btn-primary" disabled={pending}>
        {pending ? "Guardando..." : "Guardar configuración"}
      </button>
    </form>
  );
}
