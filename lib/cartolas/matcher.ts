import type { MovTipo } from "@/lib/types";

// Ventana de fechas en que se considera match (dias antes y despues).
export const VENTANA_DIAS = 3;

export type LineaParaMatch = {
  id: string;
  fecha: string; // YYYY-MM-DD
  monto: number;
  tipo: MovTipo;
};

export type MovimientoParaMatch = {
  id: string;
  fecha: string; // YYYY-MM-DD
  monto: number;
  tipo: MovTipo;
  descripcion: string | null;
  es_transferencia: boolean;
};

export type MatchExacto = {
  linea_id: string;
  movimiento_id: string;
};

export type MatchSugerencia = {
  linea_id: string;
  // Movimientos candidatos ordenados por cercania de fecha (mas cercano primero)
  candidatos: Array<{ movimiento_id: string; dias_diferencia: number }>;
};

export type ResultadoMatch = {
  exactos: MatchExacto[];
  sugerencias: MatchSugerencia[];
  sin_match_ids: string[];
};

function diffDays(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.abs(Math.round((da - db) / 86400000));
}

// Motor de match: para cada linea de cartola busca movimientos candidatos
// que sean del mismo tipo (ingreso/egreso), mismo monto exacto, no ya
// conciliados, y dentro de la ventana de ±VENTANA_DIAS dias.
//
// Reglas:
//   - Si hay UN candidato del mismo dia y sin ambiguedad -> EXACTO
//   - Si hay uno o varios candidatos con diferencia > 0 dias -> SUGERENCIA
//   - Si no hay ningun candidato -> SIN MATCH
//
// Un movimiento no puede ser candidato exacto para 2 lineas distintas: si
// dos lineas del mismo dia+monto compiten por el mismo movimiento, ambas
// caen a SUGERENCIA para que la usuaria decida.
export function calcularMatches(
  lineas: LineaParaMatch[],
  movimientos: MovimientoParaMatch[]
): ResultadoMatch {
  // Index de movimientos por (tipo|monto) para busqueda rapida.
  const porClave = new Map<string, MovimientoParaMatch[]>();
  for (const m of movimientos) {
    const key = `${m.tipo}|${m.monto}`;
    if (!porClave.has(key)) porClave.set(key, []);
    porClave.get(key)!.push(m);
  }

  type Candidato = { linea_id: string; movimiento_id: string; dias: number };
  const candidatos: Candidato[] = [];

  for (const l of lineas) {
    const key = `${l.tipo}|${l.monto}`;
    const pool = porClave.get(key) ?? [];
    for (const m of pool) {
      const d = diffDays(l.fecha, m.fecha);
      if (d <= VENTANA_DIAS) {
        candidatos.push({ linea_id: l.id, movimiento_id: m.id, dias: d });
      }
    }
  }

  // Contar ambiguedades: si un movimiento aparece como candidato de 2+ lineas,
  // ninguna es exacta (todas caen a sugerencia).
  const conteoMov = new Map<string, number>();
  for (const c of candidatos) {
    conteoMov.set(c.movimiento_id, (conteoMov.get(c.movimiento_id) ?? 0) + 1);
  }

  // Agrupar candidatos por linea.
  const porLinea = new Map<string, Candidato[]>();
  for (const c of candidatos) {
    if (!porLinea.has(c.linea_id)) porLinea.set(c.linea_id, []);
    porLinea.get(c.linea_id)!.push(c);
  }

  const exactos: MatchExacto[] = [];
  const sugerencias: MatchSugerencia[] = [];
  const sin_match_ids: string[] = [];

  // Set para trackear que movimientos ya se usaron como exactos y no re-ofrecerlos
  const movsUsadosExactos = new Set<string>();

  // Primera pasada: exactos (1:1, mismo dia, unico candidato para ambos lados)
  for (const l of lineas) {
    const cands = (porLinea.get(l.id) ?? []).slice();
    const mismoDia = cands.filter((c) => c.dias === 0);
    if (
      mismoDia.length === 1 &&
      (conteoMov.get(mismoDia[0].movimiento_id) ?? 0) === 1 &&
      !movsUsadosExactos.has(mismoDia[0].movimiento_id)
    ) {
      exactos.push({ linea_id: l.id, movimiento_id: mismoDia[0].movimiento_id });
      movsUsadosExactos.add(mismoDia[0].movimiento_id);
    }
  }

  // Segunda pasada: sugerencias y sin match. Excluir movimientos ya usados
  // como exactos.
  for (const l of lineas) {
    if (exactos.some((e) => e.linea_id === l.id)) continue;
    const cands = (porLinea.get(l.id) ?? []).filter(
      (c) => !movsUsadosExactos.has(c.movimiento_id)
    );
    if (cands.length === 0) {
      sin_match_ids.push(l.id);
      continue;
    }
    // Ordenar por cercania de fecha (mas cercano primero), luego mostrar todos.
    cands.sort((a, b) => a.dias - b.dias);
    sugerencias.push({
      linea_id: l.id,
      candidatos: cands.map((c) => ({
        movimiento_id: c.movimiento_id,
        dias_diferencia: c.dias,
      })),
    });
  }

  return { exactos, sugerencias, sin_match_ids };
}
