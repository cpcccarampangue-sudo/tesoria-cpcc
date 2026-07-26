const clpFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const clpNumberFormatter = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 0,
});

const fechaMedium = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "medium",
  timeZone: "America/Santiago",
});

const fechaLong = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "long",
  timeZone: "America/Santiago",
});

const fechaHora = new Intl.DateTimeFormat("es-CL", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Santiago",
});

export function formatCLP(monto: number | string | null | undefined): string {
  if (monto === null || monto === undefined || monto === "") return "—";
  const n = typeof monto === "string" ? Number(monto) : monto;
  if (Number.isNaN(n)) return "—";
  return clpFormatter.format(n);
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return "—";
  return clpNumberFormatter.format(num);
}

export function formatFecha(fecha: string | Date | null | undefined): string {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return "—";
  return fechaMedium.format(d);
}

export function formatFechaLarga(fecha: string | Date | null | undefined): string {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return "—";
  return fechaLong.format(d);
}

export function formatFechaHora(fecha: string | Date | null | undefined): string {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return "—";
  return fechaHora.format(d);
}

// Parsea CLP escrito por humanos: "50.000", "50000", "$50.000", "50 000"
export function parseCLPInput(s: string): number | null {
  const clean = s.replace(/[^\d]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isNaN(n) ? null : n;
}

// Fecha ISO local (YYYY-MM-DD) para <input type="date">
export function todayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
