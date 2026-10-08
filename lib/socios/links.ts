// URLs sociales/convenios con precedencia:
//   1) socio_config.cpcc_*_url (editable desde /socios/config, DB).
//   2) env var NEXT_PUBLIC_CPCC_*_URL (fallback, compat).
//   3) null -> boton oculto.
//
// NUNCA inventar URLs.

import type { SocioConfig } from "@/lib/types";

export type LinksSociales = {
  convenios: string | null;
  instagram: string | null;
  whatsapp: string | null;
};

export function linksSociales(cfg?: Pick<SocioConfig, "cpcc_instagram_url" | "cpcc_whatsapp_url" | "cpcc_convenios_url"> | null): LinksSociales {
  const dbConvenios = cfg?.cpcc_convenios_url?.trim() || null;
  const dbInstagram = cfg?.cpcc_instagram_url?.trim() || null;
  const dbWhatsapp = cfg?.cpcc_whatsapp_url?.trim() || null;
  return {
    convenios:
      dbConvenios ?? process.env.NEXT_PUBLIC_CPCC_CONVENIOS_URL ?? null,
    instagram:
      dbInstagram ?? process.env.NEXT_PUBLIC_CPCC_INSTAGRAM_URL ?? null,
    whatsapp:
      dbWhatsapp ?? process.env.NEXT_PUBLIC_CPCC_WHATSAPP_URL ?? null,
  };
}
