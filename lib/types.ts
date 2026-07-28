// Tipos de dominio compartidos entre server y cliente.

export type UserRole = "directiva" | "apoderado";
export type MovTipo = "ingreso" | "egreso";
export type CuotaEstado = "pendiente" | "pagada" | "parcial" | "exenta";

export type Apoderado = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  activo: boolean;
  created_at: string;
};

export type Estudiante = {
  id: string;
  apoderado_id: string;
  nombre: string;
  curso: string | null;
  activo: boolean;
  created_at: string;
};

export type Categoria = {
  id: string;
  nombre: string;
  tipo: MovTipo;
  activa: boolean;
};

export type Evento = {
  id: string;
  nombre: string;
  descripcion: string | null;
  fecha: string | null;
  cerrado: boolean;
  created_at: string;
};

export type CuotaPeriodo = {
  id: string;
  nombre: string;
  monto: number;
  fecha_vencimiento: string | null;
  activa: boolean;
  created_at: string;
};

export type CuotaPago = {
  id: string;
  periodo_id: string;
  apoderado_id: string;
  monto_pagado: number;
  estado: CuotaEstado;
  fecha_pago: string | null;
  nota: string | null;
};

export type Movimiento = {
  id: string;
  fecha: string;
  tipo: MovTipo;
  monto: number;
  descripcion: string | null;
  categoria_id: string | null;
  evento_id: string | null;
  cuota_pago_id: string | null;
  boleta_path: string | null;
  created_by: string | null;
  created_at: string;
};

export type BalanceGeneral = {
  total_ingresos: number;
  total_egresos: number;
  saldo: number;
};

export type BalancePorEvento = {
  id: string;
  nombre: string;
  fecha: string | null;
  cerrado: boolean;
  ingresos: number;
  egresos: number;
  neto: number;
};

export type CuotaEstadoApoderado = {
  apoderado_id: string;
  nombre: string;
  curso: string | null;
  periodo_id: string;
  periodo: string;
  monto_periodo: number;
  pagado: number;
  estado: CuotaEstado;
};
