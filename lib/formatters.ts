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

// Convierte un entero a palabras en espanol (para actas/comprobantes).
// Soporta 0..999_999_999, suficiente para montos de tesoreria de CdP.
const UNIDADES = [
  "",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
];

const DECENAS = [
  "",
  "",
  "veinti",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];

const CENTENAS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

function menorMil(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto <= 20) {
    if (resto > 0) partes.push(UNIDADES[resto]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (d === 2) {
      // veinti + unidad, todo pegado: veintiuno, veintidós, etc.
      partes.push(u === 0 ? "veinte" : DECENAS[d] + UNIDADES[u]);
    } else {
      partes.push(DECENAS[d] + (u > 0 ? " y " + UNIDADES[u] : ""));
    }
  }
  return partes.join(" ").trim();
}

export function numeroEnPalabras(n: number): string {
  if (!Number.isFinite(n)) return "";
  const entero = Math.trunc(Math.abs(n));
  if (entero === 0) return "cero";

  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;

  const partes: string[] = [];

  if (millones > 0) {
    if (millones === 1) partes.push("un millón");
    else partes.push(menorMil(millones).replace(/uno$/, "un") + " millones");
  }

  if (miles > 0) {
    if (miles === 1) partes.push("mil");
    else partes.push(menorMil(miles).replace(/uno$/, "un") + " mil");
  }

  if (resto > 0) {
    partes.push(menorMil(resto).replace(/uno$/, "un"));
  }

  return partes.join(" ").trim();
}

// Monto CLP en palabras, para comprobantes. Ej: "cien mil pesos".
export function montoCLPEnPalabras(monto: number): string {
  const palabras = numeroEnPalabras(monto);
  return `${palabras} pesos`;
}
