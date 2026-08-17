// Utilitarios comunes para parsear cartolas bancarias.

// Acepta formatos de monto usados por bancos chilenos:
//   - Banco Estado:      "$20.054.972"  (punto miles, sin decimales)
//   - Banco Chile:       "1,234,567.00" (coma miles, punto decimal)
//   - Plain:             "20054972"     o "20054972.50"
//   - Formato europeo:   "1.234.567,50" (punto miles, coma decimal) — cubierto por si acaso
// Devuelve entero (CLP no tiene decimales en la operatoria del CdP).
export function parseCLPFlexible(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "-" || s === "—" || s === "$0" || s === "0") {
    if (s === "$0" || s === "0") return 0;
    return null;
  }
  let clean = s.replace(/\$/g, "").replace(/\s+/g, "");
  if (!clean) return null;

  const hasDot = clean.includes(".");
  const hasComma = clean.includes(",");

  if (hasDot && hasComma) {
    const lastDot = clean.lastIndexOf(".");
    const lastComma = clean.lastIndexOf(",");
    if (lastDot > lastComma) {
      // Punto es el decimal (formato ingles): quitar comas de miles.
      clean = clean.replace(/,/g, "");
    } else {
      // Coma es el decimal (formato europeo): quitar puntos de miles y cambiar coma por punto.
      clean = clean.replace(/\./g, "").replace(",", ".");
    }
  } else if (hasComma) {
    // Ambiguo: coma como miles (CLP) o coma decimal.
    // Si hay 2 digitos despues de la ultima coma, es probable que sea decimal.
    const parts = clean.split(",");
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length <= 2) {
      clean = parts[0] + "." + last;
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (hasDot) {
    // Ambiguo: punto miles (CLP) o punto decimal.
    const parts = clean.split(".");
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length <= 2) {
      // Probable decimal: dejar tal cual (Number lo interpretara asi).
    } else {
      clean = clean.replace(/\./g, "");
    }
  }

  const n = Number(clean);
  if (Number.isNaN(n)) return null;
  return Math.round(n);
}

// "05/03" con año 2026 -> "2026-03-05". Tambien acepta "05/03/2026" y "05/03/26".
export function parseFechaDDMM(
  raw: unknown,
  defaultYear: number
): string | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  let yyyy = defaultYear;
  if (m[3]) {
    yyyy = Number(m[3]);
    if (yyyy < 100) yyyy = 2000 + yyyy;
  }
  const ddStr = String(dd).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  return `${yyyy}-${mmStr}-${ddStr}`;
}

// Busca en un DD/MM/YYYY libre dentro de una celda y devuelve el año.
export function extraerAnioDeFecha(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100) return null;
  return y;
}
