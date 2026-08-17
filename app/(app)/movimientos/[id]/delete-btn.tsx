"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eliminarMovimiento } from "../actions";

export function DeleteBtn({
  id,
  esTransferencia = false,
}: {
  id: string;
  esTransferencia?: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const label = esTransferencia
    ? "Eliminar transferencia (ambos lados)"
    : "Eliminar este movimiento";
  const confirmMsg = esTransferencia
    ? "Se borrarán los dos lados de la transferencia. ¿Confirmas?"
    : "¿Estás seguro?";

  if (!confirm) {
    return (
      <button
        className="text-xs text-red-600 hover:underline"
        onClick={() => setConfirm(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-slate-600">{confirmMsg}</span>
      <button
        className="btn-danger text-xs"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await eliminarMovimiento(id);
            router.push("/movimientos");
          })
        }
      >
        Sí, eliminar
      </button>
      <button
        className="btn-secondary text-xs"
        onClick={() => setConfirm(false)}
      >
        Cancelar
      </button>
    </div>
  );
}
