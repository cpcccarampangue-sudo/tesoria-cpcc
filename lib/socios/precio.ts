// Decide el precio vigente de la cuota de socio.
//
// Fuente de verdad: socio_config.monto_cuota_normal + columnas de
// promocion. La columna legacy socio_config.monto_cuota NO se lee aqui
// (quedo deprecada en migracion 024).
//
// Reglas (ver tambien el CHECK socio_config_promocion_coherente):
//   - Si hay promocion valida y now esta en [inicio, fin) -> precio promo.
//   - En cualquier otro caso -> precio normal.
//   - Si monto_cuota_normal es null o <= 0 -> fallback PRECIO_FALLBACK.
//   - Rango invertido o inconsistente -> precio normal (defensa en
//     profundidad; el CHECK de BD ya lo impide).
//
// Semantica del rango: inclusivo en inicio, exclusivo en fin. Esto
// garantiza CERO gap horario entre promo y precio normal: el instante
// exacto de fin ya cae en precio normal, el milisegundo anterior cae
// en promo. Si quieres promo "hasta el 31/12 23:59:59 inclusive",
// setea promocion_fin = inicio de la ventana siguiente (p.ej. 2027-01-01
// 00:00:00 en Santiago).

import type { SocioConfig } from "@/lib/types";

export const PRECIO_FALLBACK = 20000;

export function precioNormal(cfg: SocioConfig): number {
  const n = cfg.monto_cuota_normal;
  return n && n > 0 ? n : PRECIO_FALLBACK;
}

export function precioVigente(
  cfg: SocioConfig,
  now: Date = new Date()
): number {
  const normal = precioNormal(cfg);
  const promo = cfg.monto_cuota_promocional;
  const ini = cfg.promocion_inicio ? new Date(cfg.promocion_inicio) : null;
  const fin = cfg.promocion_fin ? new Date(cfg.promocion_fin) : null;

  if (
    !promo ||
    promo <= 0 ||
    !ini ||
    !fin ||
    isNaN(ini.getTime()) ||
    isNaN(fin.getTime()) ||
    fin <= ini
  ) {
    return normal;
  }
  return now >= ini && now < fin ? promo : normal;
}

export type InfoPrecio = {
  precio: number;
  precioNormal: number;
  precioPromocional: number | null;
  enPromocion: boolean;
  promocionInicio: string | null;
  promocionFin: string | null;
};

// Devuelve el Payment Link SumUp que corresponde EXACTAMENTE al monto
// solicitado. Si el monto no coincide con ninguno de los precios
// configurados o el link correspondiente no esta configurado, devuelve
// null — en ese caso la UI debe mostrar aviso en vez de un boton que
// cobre el monto equivocado.
//
// La cuenta SumUp del CdP solo soporta Payment Links fijos (no API
// Online Payments dinamica), por eso necesitamos dos links separados.
export function linkParaMonto(
  cfg: SocioConfig,
  monto: number
): string | null {
  if (!Number.isFinite(monto) || monto <= 0) return null;
  if (cfg.monto_cuota_promocional === monto && cfg.sumup_link_promo) {
    return cfg.sumup_link_promo;
  }
  if (cfg.monto_cuota_normal === monto && cfg.sumup_link_normal) {
    return cfg.sumup_link_normal;
  }
  return null;
}

// Vista enriquecida para UI (muestra "promo vigente hasta X" / "a partir de Y").
export function infoPrecio(
  cfg: SocioConfig,
  now: Date = new Date()
): InfoPrecio {
  const normal = precioNormal(cfg);
  const precio = precioVigente(cfg, now);
  return {
    precio,
    precioNormal: normal,
    precioPromocional: cfg.monto_cuota_promocional,
    enPromocion: precio !== normal,
    promocionInicio: cfg.promocion_inicio,
    promocionFin: cfg.promocion_fin,
  };
}
