// Helpers para el link "Volver" contextual en paginas de detalle/subpaginas
// (movimientos, cartolas, etc.). El origen le pasa a la subpagina un query
// param `?volver=/ruta` y la subpagina lo usa para armar el link de vuelta
// con una etiqueta acorde (ej: "Volver al evento" en vez de "Volver a
// movimientos"). Si no viene, se usa el destino por defecto.

export type VolverDestino = {
  href: string;
  label: string;
};

export function resolverVolver(
  volver: string | undefined,
  porDefecto: VolverDestino
): VolverDestino {
  if (!volver || !volver.startsWith("/")) return porDefecto;
  if (volver.startsWith("/eventos/")) {
    return { href: volver, label: "← Volver al evento" };
  }
  if (/^\/cartolas\/[^/]+\/reconciliar/.test(volver)) {
    return { href: volver, label: "← Volver a la reconciliación" };
  }
  if (volver.startsWith("/cartolas/")) {
    return { href: volver, label: "← Volver a la cartola" };
  }
  if (volver.startsWith("/apoderados/")) {
    return { href: volver, label: "← Volver a la familia" };
  }
  return { href: volver, label: "← Volver" };
}
