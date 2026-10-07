// Helpers de zona horaria America/Santiago. Chile tiene DST con offsets
// -03 (CLST, verano) y -04 (CLT, invierno). Las funciones aqui usan la
// zoneinfo nativa de Node (Intl.DateTimeFormat) que la respeta
// automaticamente — nunca hardcodear offsets.
//
// Uso tipico: los <input type="datetime-local"> entregan strings sin
// zona (ej. "2026-12-31T23:59:59"). El server los interpreta como hora
// chilena y los persiste como timestamptz. Al releer, convierte de UTC
// al string local para pre-llenar el input.

const TZ = "America/Santiago";

// Convierte "YYYY-MM-DDTHH:mm" o "YYYY-MM-DDTHH:mm:ss" interpretado en
// zona Santiago a un Date UTC absoluto. Null si el string esta vacio.
// Lanza si el formato es invalido.
export function chileLocalToUtc(local: string | null | undefined): Date | null {
  if (!local) return null;
  const trimmed = String(local).trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    throw new Error(
      `Formato de fecha-hora invalido: "${trimmed}". Esperado YYYY-MM-DDTHH:mm[:ss].`
    );
  }
  // Interpretamos primero como UTC "a secas". El resultado NO es la
  // instancia correcta; es un pivote para calcular el offset.
  const pivote = new Date(trimmed + "Z");
  if (isNaN(pivote.getTime())) {
    throw new Error(`Fecha-hora no parseable: "${trimmed}".`);
  }
  // Averiguamos que string ISO (en zona Santiago) corresponde al pivote.
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const santiagoDeString = fmt.format(pivote).replace(" ", "T");
  const santiagoAsIfUtc = new Date(santiagoDeString + "Z");
  // La diferencia entre pivote (UTC) y santiago-leido-como-UTC es el
  // offset de Santiago para esa fecha. Para obtener la instancia UTC
  // real correspondiente al local chileno, sumamos ese offset al pivote.
  const offsetMs = pivote.getTime() - santiagoAsIfUtc.getTime();
  return new Date(pivote.getTime() + offsetMs);
}

// Convierte un Date / ISO a string "YYYY-MM-DDTHH:mm" expresado en
// zona Santiago. Util para pre-llenar <input type="datetime-local">.
export function utcToChileLocal(
  d: Date | string | null | undefined
): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(date).replace(" ", "T");
}

// Formatea para display al usuario: "31/12/2026 23:59" en zona Santiago.
export function formatearChileCorto(
  d: Date | string | null | undefined
): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("es-CL", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(date).replace(",", "");
}
