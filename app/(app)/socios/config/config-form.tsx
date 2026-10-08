"use client";

import { useMemo, useState, useTransition } from "react";
import type { SocioConfig } from "@/lib/types";
import { actualizarSocioConfig, previewCorreoSocio } from "../actions";
import { utcToChileLocal } from "@/lib/tz-chile";
import { precioVigente } from "@/lib/socios/precio";

type CuentaOp = { id: string; nombre: string; es_principal: boolean };
type CategoriaOp = { id: string; nombre: string };

export function ConfigForm({
  config,
  cuentas,
  categorias,
}: {
  config: SocioConfig;
  cuentas: CuentaOp[];
  categorias: CategoriaOp[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<
    "bienvenida" | "renovacion" | null
  >(null);
  const [previewHtml, setPreviewHtml] = useState<{
    subject: string;
    html: string;
    tipo: "bienvenida" | "renovacion";
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form, setForm] = useState({
    periodo_anio: String(config.periodo_anio),
    periodo_inicio: config.periodo_inicio ?? "",
    periodo_fin: config.periodo_fin ?? "",
    monto_cuota_normal: String(config.monto_cuota_normal ?? ""),
    monto_cuota_promocional: String(config.monto_cuota_promocional ?? ""),
    promocion_inicio: utcToChileLocal(config.promocion_inicio),
    promocion_fin: utcToChileLocal(config.promocion_fin),
    sumup_link_promo: config.sumup_link_promo ?? "",
    sumup_link_normal: config.sumup_link_normal ?? "",
    cuenta_sumup_id: config.cuenta_sumup_id ?? "",
    categoria_cuota_id: config.categoria_cuota_id ?? "",
    mensaje_bienvenida: config.mensaje_bienvenida ?? "",
    cpcc_instagram_url: config.cpcc_instagram_url ?? "",
    cpcc_whatsapp_url: config.cpcc_whatsapp_url ?? "",
    cpcc_convenios_url: config.cpcc_convenios_url ?? "",
    correo_bienvenida_asunto: config.correo_bienvenida_asunto ?? "",
    correo_bienvenida_cuerpo: config.correo_bienvenida_cuerpo ?? "",
    correo_renovacion_asunto: config.correo_renovacion_asunto ?? "",
    correo_renovacion_cuerpo: config.correo_renovacion_cuerpo ?? "",
  });

  async function handlePreview(tipo: "bienvenida" | "renovacion") {
    setPreviewError(null);
    setPreviewLoading(tipo);
    try {
      const res = await previewCorreoSocio(tipo, {
        cpcc_instagram_url: form.cpcc_instagram_url.trim() || null,
        cpcc_whatsapp_url: form.cpcc_whatsapp_url.trim() || null,
        cpcc_convenios_url: form.cpcc_convenios_url.trim() || null,
        correo_bienvenida_asunto:
          form.correo_bienvenida_asunto.trim() || null,
        correo_bienvenida_cuerpo:
          form.correo_bienvenida_cuerpo.trim() || null,
        correo_renovacion_asunto:
          form.correo_renovacion_asunto.trim() || null,
        correo_renovacion_cuerpo:
          form.correo_renovacion_cuerpo.trim() || null,
      });
      setPreviewHtml({ ...res, tipo });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Error.");
    } finally {
      setPreviewLoading(null);
    }
  }

  // Preview del precio que se cobraria ahora mismo con lo que esta en el
  // formulario. Util para que la directiva vea cual es el precio vigente
  // antes de guardar.
  const preview = useMemo(() => {
    const normal = parseInt(form.monto_cuota_normal, 10);
    const promo = form.monto_cuota_promocional
      ? parseInt(form.monto_cuota_promocional, 10)
      : null;
    const cfgPreview: SocioConfig = {
      ...config,
      monto_cuota_normal: Number.isFinite(normal) && normal > 0 ? normal : null,
      monto_cuota_promocional:
        promo && Number.isFinite(promo) && promo > 0 ? promo : null,
      promocion_inicio: form.promocion_inicio
        ? // Nota: aqui pasamos el string local; precioVigente lo tratara
          // como UTC si no tiene tz. Para el preview es suficiente — el
          // calculo definitivo lo hace el servidor.
          form.promocion_inicio
        : null,
      promocion_fin: form.promocion_fin ? form.promocion_fin : null,
    };
    try {
      return precioVigente(cfgPreview);
    } catch {
      return null;
    }
  }, [config, form.monto_cuota_normal, form.monto_cuota_promocional, form.promocion_inicio, form.promocion_fin]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const periodoAnio = parseInt(form.periodo_anio, 10);
    const montoNormal = parseInt(form.monto_cuota_normal, 10);
    const montoPromo = form.monto_cuota_promocional.trim()
      ? parseInt(form.monto_cuota_promocional, 10)
      : null;
    if (!Number.isInteger(periodoAnio) || periodoAnio < 2020) {
      setError("Año inválido.");
      return;
    }
    if (!Number.isInteger(montoNormal) || montoNormal <= 0) {
      setError("El precio normal debe ser un entero positivo.");
      return;
    }
    // Promo: si hay cualquier campo, deben estar los 3 (precio + inicio + fin).
    const hayAlgoPromo =
      montoPromo !== null ||
      form.promocion_inicio.trim() !== "" ||
      form.promocion_fin.trim() !== "";
    if (hayAlgoPromo) {
      if (
        montoPromo === null ||
        !Number.isInteger(montoPromo) ||
        montoPromo <= 0
      ) {
        setError(
          "Si configuras una promoción, el precio promocional debe ser un entero positivo."
        );
        return;
      }
      if (montoPromo > montoNormal) {
        setError(
          "El precio promocional no puede ser mayor que el precio normal."
        );
        return;
      }
      if (!form.promocion_inicio.trim() || !form.promocion_fin.trim()) {
        setError(
          "Si configuras una promoción, define las fechas de inicio y fin."
        );
        return;
      }
      if (form.promocion_inicio >= form.promocion_fin) {
        setError(
          "La fecha de inicio de la promoción debe ser anterior a la fecha de fin."
        );
        return;
      }
    }
    startTransition(async () => {
      try {
        await actualizarSocioConfig({
          periodo_anio: periodoAnio,
          periodo_inicio: form.periodo_inicio || null,
          periodo_fin: form.periodo_fin || null,
          monto_cuota_normal: montoNormal,
          monto_cuota_promocional: hayAlgoPromo ? montoPromo : null,
          promocion_inicio: hayAlgoPromo ? form.promocion_inicio : null,
          promocion_fin: hayAlgoPromo ? form.promocion_fin : null,
          sumup_link_promo: form.sumup_link_promo.trim() || null,
          sumup_link_normal: form.sumup_link_normal.trim() || null,
          cuenta_sumup_id: form.cuenta_sumup_id || null,
          categoria_cuota_id: form.categoria_cuota_id || null,
          mensaje_bienvenida: form.mensaje_bienvenida.trim() || null,
          cpcc_instagram_url: form.cpcc_instagram_url.trim() || null,
          cpcc_whatsapp_url: form.cpcc_whatsapp_url.trim() || null,
          cpcc_convenios_url: form.cpcc_convenios_url.trim() || null,
          correo_bienvenida_asunto:
            form.correo_bienvenida_asunto.trim() || null,
          correo_bienvenida_cuerpo:
            form.correo_bienvenida_cuerpo.trim() || null,
          correo_renovacion_asunto:
            form.correo_renovacion_asunto.trim() || null,
          correo_renovacion_cuerpo:
            form.correo_renovacion_cuerpo.trim() || null,
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

      <div className="border-t border-slate-200 pt-3">
        <h3 className="font-medium text-slate-800">
          Precio de la cuota
        </h3>
        <p className="text-xs text-slate-500 mb-3 mt-1">
          El servidor cobra siempre el precio vigente según la fecha. Si
          no configuras promoción, se cobra el precio normal.
        </p>

        <div>
          <label className="label">Precio normal (CLP)</label>
          <input
            type="number"
            className="input"
            value={form.monto_cuota_normal}
            onChange={(e) =>
              setForm((f) => ({ ...f, monto_cuota_normal: e.target.value }))
            }
            min={100}
            step={100}
            required
            placeholder="20000"
          />
        </div>

        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Promoción (opcional)
          </div>
          <div>
            <label className="label">Precio promocional (CLP)</label>
            <input
              type="number"
              className="input"
              value={form.monto_cuota_promocional}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  monto_cuota_promocional: e.target.value,
                }))
              }
              min={100}
              step={100}
              placeholder="18500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">
                Promoción desde (hora de Chile)
              </label>
              <input
                type="datetime-local"
                step={1}
                className="input"
                value={form.promocion_inicio}
                onChange={(e) =>
                  setForm((f) => ({ ...f, promocion_inicio: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="label">
                Promoción hasta (exclusivo; hora de Chile)
              </label>
              <input
                type="datetime-local"
                step={1}
                className="input"
                value={form.promocion_fin}
                onChange={(e) =>
                  setForm((f) => ({ ...f, promocion_fin: e.target.value }))
                }
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            La promoción aplica desde el inicio inclusivo hasta el fin{" "}
            <strong>exclusivo</strong>. Para que la promoción cubra todo el
            31/12 y el precio normal arranque el 01/01 a las 00:00, define
            fin = <code>2027-01-01 00:00:00</code>.
          </p>
        </div>
      </div>

      {preview !== null && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-900 p-3">
          Precio vigente que se cobraría ahora mismo con esta configuración:{" "}
          <strong>${preview.toLocaleString("es-CL")} CLP</strong>
        </div>
      )}

      <div className="border-t border-slate-200 pt-3 space-y-3">
        <div>
          <h3 className="font-medium text-slate-800">
            Links de pago SumUp
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Debes crear <strong>dos Payment Links</strong> en tu cuenta
            SumUp (desde el panel de SumUp): uno con el precio promocional
            y otro con el precio normal. Pega aquí el link de cada uno. El
            sistema elige automáticamente el que corresponda al precio
            vigente al crear la solicitud.
          </p>
        </div>
        <div>
          <label className="label">
            Link SumUp para precio promocional{" "}
            <span className="text-xs text-slate-500 font-normal">
              (${form.monto_cuota_promocional || "—"} CLP)
            </span>
          </label>
          <input
            type="url"
            className="input"
            value={form.sumup_link_promo}
            onChange={(e) =>
              setForm((f) => ({ ...f, sumup_link_promo: e.target.value }))
            }
            placeholder="https://pay.sumup.com/b2c/XXXXXX"
          />
        </div>
        <div>
          <label className="label">
            Link SumUp para precio normal{" "}
            <span className="text-xs text-slate-500 font-normal">
              (${form.monto_cuota_normal || "—"} CLP)
            </span>
          </label>
          <input
            type="url"
            className="input"
            value={form.sumup_link_normal}
            onChange={(e) =>
              setForm((f) => ({ ...f, sumup_link_normal: e.target.value }))
            }
            placeholder="https://pay.sumup.com/b2c/XXXXXX"
          />
        </div>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
          Verifica que el monto configurado en cada Payment Link SumUp
          coincida exactamente con los precios de arriba. Si no coinciden,
          la familia pagará un monto distinto al que indica el sistema.
        </p>
      </div>

      <div className="border-t border-slate-200 pt-3">
        <h3 className="font-medium text-slate-800 mb-2">
          Integración con el libro de caja
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Cuando se confirma un pago (manual o vía webhook SumUp), se crea
          automáticamente un movimiento tipo ingreso usando estos valores.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">
              Cuenta destino para pagos SumUp automáticos
            </label>
            <select
              className="input"
              value={form.cuenta_sumup_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, cuenta_sumup_id: e.target.value }))
              }
            >
              <option value="">— sin configurar —</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.es_principal ? " (principal)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Cuando SumUp confirma un pago vía webhook, el movimiento
              generado se registra en esta cuenta. Si no se configura, el
              webhook no crea movimiento automático (igual se marca pagada
              y se envía el QR).
            </p>
          </div>
          <div>
            <label className="label">Categoría del ingreso</label>
            <select
              className="input"
              value={form.categoria_cuota_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, categoria_cuota_id: e.target.value }))
              }
            >
              <option value="">— sin categoría —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Categoría que se asigna al movimiento (ej. &quot;Cuota socio
              CdP&quot;). Útil para filtrar en reportes.
            </p>
          </div>
        </div>
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

      <div className="border-t border-slate-200 pt-3 space-y-3">
        <div>
          <h3 className="font-medium text-slate-800">
            Links sociales en los correos de socios
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Estos botones aparecen al final del correo que recibe la familia
            tras pagar. Si dejas un campo vacío, el botón correspondiente
            <strong> no aparece</strong>. Deben empezar con{" "}
            <code>https://</code>.
          </p>
        </div>
        <div>
          <label className="label">URL de convenios CPCC</label>
          <input
            type="url"
            className="input"
            value={form.cpcc_convenios_url}
            onChange={(e) =>
              setForm((f) => ({ ...f, cpcc_convenios_url: e.target.value }))
            }
            placeholder="https://tesoria-cpcc.vercel.app/convenios"
          />
        </div>
        <div>
          <label className="label">URL de Instagram CPCC</label>
          <input
            type="url"
            className="input"
            value={form.cpcc_instagram_url}
            onChange={(e) =>
              setForm((f) => ({ ...f, cpcc_instagram_url: e.target.value }))
            }
            placeholder="https://instagram.com/cpcc_colegiocarampangue"
          />
        </div>
        <div>
          <label className="label">URL de WhatsApp CPCC</label>
          <input
            type="url"
            className="input"
            value={form.cpcc_whatsapp_url}
            onChange={(e) =>
              setForm((f) => ({ ...f, cpcc_whatsapp_url: e.target.value }))
            }
            placeholder="https://chat.whatsapp.com/XXXXXXX"
          />
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3 space-y-4">
        <div>
          <h3 className="font-medium text-slate-800">
            Textos de los correos de socios
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Puedes personalizar el asunto y el cuerpo del correo. El diseño
            visual (encabezado, tabla con los datos de la familia, QR y
            botones) permanece fijo para que el correo se vea siempre
            profesional. Si dejas un campo vacío, se usa el texto por
            defecto.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Variables disponibles:{" "}
            <code>{"{{nombre}}"}</code> (nombre de la familia),{" "}
            <code>{"{{periodo}}"}</code> (año del período),{" "}
            <code>{"{{monto}}"}</code> (monto pagado).
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Correo de bienvenida (socio nuevo)
          </div>
          <div>
            <label className="label">Asunto</label>
            <input
              type="text"
              className="input"
              value={form.correo_bienvenida_asunto}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  correo_bienvenida_asunto: e.target.value,
                }))
              }
              maxLength={200}
              placeholder="¡Bienvenidos como socios CPCC {{periodo}}! 💙"
            />
          </div>
          <div>
            <label className="label">Cuerpo</label>
            <textarea
              className="input font-mono text-xs"
              rows={8}
              value={form.correo_bienvenida_cuerpo}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  correo_bienvenida_cuerpo: e.target.value,
                }))
              }
              maxLength={4000}
              placeholder="Hola {{nombre}},..."
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => handlePreview("bienvenida")}
            disabled={previewLoading !== null}
          >
            {previewLoading === "bienvenida"
              ? "Generando..."
              : "Vista previa bienvenida"}
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Correo de renovación (socio existente)
          </div>
          <div>
            <label className="label">Asunto</label>
            <input
              type="text"
              className="input"
              value={form.correo_renovacion_asunto}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  correo_renovacion_asunto: e.target.value,
                }))
              }
              maxLength={200}
              placeholder="¡Gracias por renovar tu membresía CPCC {{periodo}}! 💙"
            />
          </div>
          <div>
            <label className="label">Cuerpo</label>
            <textarea
              className="input font-mono text-xs"
              rows={8}
              value={form.correo_renovacion_cuerpo}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  correo_renovacion_cuerpo: e.target.value,
                }))
              }
              maxLength={4000}
              placeholder="Hola {{nombre}},..."
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => handlePreview("renovacion")}
            disabled={previewLoading !== null}
          >
            {previewLoading === "renovacion"
              ? "Generando..."
              : "Vista previa renovación"}
          </button>
        </div>

        {previewError && (
          <div className="text-sm bg-red-50 text-red-800 rounded-md p-3">
            {previewError}
          </div>
        )}
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

      {previewHtml && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewHtml(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500 uppercase tracking-wider">
                  Vista previa —{" "}
                  {previewHtml.tipo === "bienvenida"
                    ? "bienvenida"
                    : "renovación"}
                </div>
                <div className="text-sm font-medium text-slate-900 truncate">
                  {previewHtml.subject}
                </div>
              </div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-900 text-sm"
                onClick={() => setPreviewHtml(null)}
                aria-label="Cerrar vista previa"
              >
                ✕
              </button>
            </div>
            <iframe
              srcDoc={previewHtml.html}
              className="flex-1 w-full border-0 rounded-b-xl"
              sandbox=""
              title="Vista previa del correo"
            />
          </div>
        </div>
      )}
    </form>
  );
}
