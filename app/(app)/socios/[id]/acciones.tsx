"use client";

import { useState, useTransition } from "react";
import type { SocioSolicitud } from "@/lib/types";
import {
  marcarSolicitudEnviada,
  rechazarSolicitud,
  anularSolicitud,
} from "../actions";
import { VincularFamilia } from "./vincular-familia";
import { PagoManualDialog, type CuentaOp } from "./pago-manual";
import { ReenviarCorreoDialog } from "./reenviar-modal";

export function AccionesSolicitud({
  solicitud: s,
  cuentas,
}: {
  solicitud: SocioSolicitud;
  cuentas: CuentaOp[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmRechazo, setConfirmRechazo] = useState(false);
  const [notas, setNotas] = useState("");

  function run(fn: () => Promise<void>) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await fn();
        setSuccess("Acción completada.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error.");
      }
    });
  }

  return (
    <div className="space-y-3 text-sm">
      {s.estado === "pendiente_match" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-3">
          <div className="text-sm text-amber-900">
            <strong>Pendiente de identificar.</strong> El apoderado llenó el
            formulario manualmente porque no se encontró en el listado del
            colegio. Vincula esta solicitud con la familia correcta para
            continuar.
          </div>
          <VincularFamilia solicitudId={s.id} />
        </div>
      )}

      {s.estado === "pendiente_pago" && (
        <div className="space-y-2">
          <PagoManualDialog
            solicitudId={s.id}
            monto={s.monto_cuota}
            cuentas={cuentas}
          />
          <div>
            <button
              className="text-xs text-slate-600 hover:underline"
              disabled={pending}
              onClick={() => run(() => anularSolicitud(s.id))}
            >
              Anular solicitud
            </button>
          </div>
          <p className="text-xs text-slate-500">
            El pago manual crea automáticamente un movimiento tipo ingreso
            en la cuenta seleccionada. Si el pago vino por SumUp y ya se
            registró vía webhook, no necesitas hacer esto.
          </p>
        </div>
      )}

      {s.estado === "pagada" && (
        <div className="flex flex-wrap gap-2">
          <ReenviarCorreoDialog
            solicitudId={s.id}
            correoRegistrado={s.apoderado_email}
            label="Enviar QR por correo"
            icon="📧"
          />
          <button
            className="btn-secondary"
            disabled={pending}
            onClick={() => run(() => marcarSolicitudEnviada(s.id))}
          >
            Marcar como enviada (sin reenvío)
          </button>
          <p className="text-xs text-slate-500 w-full">
            El pago está confirmado. Envía el QR al correo del apoderado.
          </p>
        </div>
      )}

      {s.estado === "enviada" && (
        <div className="flex flex-wrap gap-2">
          <ReenviarCorreoDialog
            solicitudId={s.id}
            correoRegistrado={s.apoderado_email}
            label="Reenviar QR"
            icon="🔁"
          />
          <p className="text-xs text-slate-500 w-full">
            Si el apoderado reporta que no recibió el correo o lo perdió,
            puedes reenviarlo. Reenvíos:{" "}
            <strong>{s.email_reenvios}</strong>.
          </p>
        </div>
      )}

      {(s.estado === "pendiente_pago" || s.estado === "pagada") &&
        !confirmRechazo && (
          <div>
            <button
              className="text-red-600 hover:underline text-sm"
              onClick={() => setConfirmRechazo(true)}
            >
              Rechazar solicitud...
            </button>
          </div>
        )}

      {confirmRechazo && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
          <div className="font-medium text-red-900">
            ¿Rechazar esta solicitud?
          </div>
          <textarea
            className="input text-sm"
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Motivo (opcional, queda como nota interna)"
          />
          <div className="flex gap-2">
            <button
              className="btn-primary bg-red-600 hover:bg-red-700"
              disabled={pending}
              onClick={() => run(() => rechazarSolicitud(s.id, notas))}
            >
              Confirmar rechazo
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                setConfirmRechazo(false);
                setNotas("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(s.estado === "rechazada" || s.estado === "anulada") && (
        <div className="text-xs text-slate-500">
          Esta solicitud fue{" "}
          {s.estado === "rechazada" ? "rechazada" : "anulada"} y no se puede
          revertir desde la UI. Si fue por error, elimínala directamente
          desde la base de datos y pide al apoderado que vuelva a llenar el
          formulario.
        </div>
      )}

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

      <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
        El QR se genera al vuelo codificando la URL pública{" "}
        <code>/socio/{s.qr_token.slice(0, 8)}...</code> y se envía al
        correo del apoderado vía Resend.
      </p>
    </div>
  );
}
