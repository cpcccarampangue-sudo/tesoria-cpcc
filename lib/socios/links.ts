// URLs sociales/convenios configurables por env vars. Si una var no
// esta seteada, el link correspondiente devuelve null y el UI debe
// omitir el boton (NUNCA inventar URLs).

export type LinksSociales = {
  convenios: string | null;
  instagram: string | null;
  whatsapp: string | null;
};

export function linksSociales(): LinksSociales {
  return {
    convenios: process.env.NEXT_PUBLIC_CPCC_CONVENIOS_URL || null,
    instagram: process.env.NEXT_PUBLIC_CPCC_INSTAGRAM_URL || null,
    whatsapp: process.env.NEXT_PUBLIC_CPCC_WHATSAPP_URL || null,
  };
}
