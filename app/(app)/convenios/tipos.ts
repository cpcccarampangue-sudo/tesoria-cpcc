// Tipos del modulo convenios. En archivo aparte de actions.ts porque
// actions.ts es "use server" y solo puede exportar funciones async.

export type Convenio = {
  id: string;
  nombre: string;
  descripcion: string | null;
  logo_url: string | null;
  active: boolean;
  valid_from: string | null; // "YYYY-MM-DD"
  valid_until: string | null;
  imported_at: string | null;
  source_row: number | null;
  created_at: string;
  updated_at: string;
};

export type ConvenioOperador = {
  id: string;
  convenio_id: string;
  email_normalized: string;
  active: boolean;
  revoked_at: string | null;
  imported_at: string | null;
  source_row: number | null;
  created_at: string;
};

export type ConvenioConOperadores = Convenio & {
  operadores: ConvenioOperador[];
};
