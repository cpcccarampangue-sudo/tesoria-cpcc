// HMAC-SHA256 para pseudonimizar identificadores en validaciones_log.
//
// Reglas (ver [[project-auditoria-hmac]] en memoria del proyecto):
//   - Usar la primitiva HMAC real: createHmac("sha256", secret).
//     Prohibido sha256(secret + valor) u otras concatenaciones.
//   - El secreto AUDIT_HMAC_SECRET es independiente de OTP_SECRET.
//     Debe ser >=32 bytes aleatorios. Generar con `openssl rand -hex 32`.
//   - Es clave de auditoria a largo plazo: NO rotar sin plan de
//     versionado — rotarla rompe la correlacion de todos los HMACs
//     historicos.
//
// Se usa para:
//   - qr_token_hmac en validaciones_log (reemplaza almacenar el token QR)
//   - directiva_actor_hmac en validaciones_log (reemplaza FK a auth.users)

import { createHmac } from "crypto";

const MIN_LEN = 32;

function secret(): string {
  const s = process.env.AUDIT_HMAC_SECRET;
  if (!s || s.length < MIN_LEN) {
    throw new Error(
      `AUDIT_HMAC_SECRET no esta configurado (minimo ${MIN_LEN} caracteres).`
    );
  }
  return s;
}

export function hmacAudit(valor: string): string {
  return createHmac("sha256", secret()).update(valor).digest("hex");
}
