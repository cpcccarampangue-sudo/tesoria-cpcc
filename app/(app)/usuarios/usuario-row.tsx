"use client";

import { useState, useTransition } from "react";
import type { UserRole } from "@/lib/types";
import { cambiarRolUsuario, eliminarUsuario } from "./actions";

type Usuario = {
  id: string;
  email: string;
  nombre: string | null;
  role: UserRole;
  apoderado_id: string | null;
  curso_asignado: string | null;
  apoderado: { nombre: string } | null;
};

export function UsuarioRow({
  u,
  cursos,
  esYo,
  altaLabel,
}: {
  u: Usuario;
  cursos: string[];
  esYo: boolean;
  altaLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [role, setRole] = useState<UserRole>(u.role);
  const [cursoAsignado, setCursoAsignado] = useState<string>(
    u.curso_asignado ?? ""
  );
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const changed =
    role !== u.role ||
    (role === "delegado" && cursoAsignado !== (u.curso_asignado ?? ""));

  function guardar() {
    setMessage(null);
    if (role === "delegado" && !cursoAsignado.trim()) {
      setMessage({ type: "err", text: "Elige un curso para el delegado." });
      return;
    }
    startTransition(async () => {
      try {
        await cambiarRolUsuario(
          u.id,
          role,
          role === "delegado" ? cursoAsignado.trim() : null
        );
        setMessage({ type: "ok", text: "Actualizado." });
      } catch (err) {
        setMessage({
          type: "err",
          text: err instanceof Error ? err.message : "Error.",
        });
      }
    });
  }

  const badgeClass =
    role === "directiva"
      ? "badge-blue"
      : role === "delegado"
      ? "badge-amber"
      : "badge-slate";

  return (
    <tr>
      <td className="table-td font-medium">
        {u.email}
        {esYo && <span className="text-xs text-slate-500 ml-1">(tú)</span>}
      </td>
      <td className="table-td text-sm">
        {u.apoderado?.nombre ?? (
          <span className="text-slate-400">— sin vincular —</span>
        )}
      </td>
      <td className="table-td">
        <div className="flex items-center gap-2">
          <select
            className="input text-xs w-auto"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={pending || esYo}
          >
            <option value="apoderado">Apoderado</option>
            <option value="delegado">Delegado</option>
            <option value="directiva">Directiva</option>
          </select>
          <span className={`${badgeClass} text-[10px]`}>{role}</span>
        </div>
      </td>
      <td className="table-td">
        {role === "delegado" ? (
          <select
            className="input text-xs w-auto"
            value={cursoAsignado}
            onChange={(e) => setCursoAsignado(e.target.value)}
            disabled={pending}
          >
            <option value="">— elegir curso —</option>
            {cursos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-slate-400 text-xs">—</span>
        )}
      </td>
      <td className="table-td text-xs text-slate-500">{altaLabel}</td>
      <td className="table-td text-right">
        <div className="flex items-center justify-end gap-2">
          {changed && (
            <button
              className="btn-primary text-xs px-2 py-1"
              disabled={pending}
              onClick={guardar}
            >
              {pending ? "..." : "Guardar"}
            </button>
          )}
          {message && (
            <span
              className={`text-xs ${
                message.type === "ok" ? "text-green-700" : "text-red-700"
              }`}
            >
              {message.text}
            </span>
          )}
          {!esYo && !changed && (
            <>
              {confirm ? (
                <>
                  <button
                    className="text-xs text-red-700 font-semibold"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await eliminarUsuario(u.id);
                        } catch (err) {
                          setMessage({
                            type: "err",
                            text: err instanceof Error ? err.message : "Error.",
                          });
                          setConfirm(false);
                        }
                      })
                    }
                  >
                    Confirmar
                  </button>
                  <button
                    className="text-xs text-slate-500"
                    onClick={() => setConfirm(false)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => setConfirm(true)}
                >
                  Eliminar
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
