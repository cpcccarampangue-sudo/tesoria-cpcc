// Helper compartido por las vistas imprimibles (actas, certificados) para
// resolver la firma escaneada de cada miembro de la directiva a una signed
// URL firmada por Supabase Storage. Si un miembro no tiene firma cargada
// (firma_path null), su entrada queda con firmaUrl null y la vista deja la
// linea vacia como hasta ahora.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaCargo, DirectivaMiembro } from "@/lib/types";

export type FirmanteConFirma = {
  cargo: DirectivaCargo;
  nombre: string;
  rut: string;
  firmaUrl: string | null;
};

// Recibe la lista de miembros activos y los cargos solicitados, y devuelve
// un arreglo listo para renderizar (con la signed URL de la firma si aplica).
// Los cargos que no tengan miembro activo simplemente no aparecen en la
// salida, salvo "tesorero" que cae a un default fijo si no hay miembro.
export async function resolverFirmantes(
  cargosPedidos: DirectivaCargo[],
  directivaActiva: DirectivaMiembro[],
  defaults: { nombre: string; rut: string }
): Promise<FirmanteConFirma[]> {
  const firmantes: FirmanteConFirma[] = [];
  const pathsAResolver: string[] = [];
  const indexPorPath = new Map<string, number>();

  for (const cargo of cargosPedidos) {
    const miembro = directivaActiva.find((d) => d.cargo === cargo);
    if (miembro) {
      firmantes.push({
        cargo,
        nombre: miembro.nombre,
        rut: miembro.rut,
        firmaUrl: null,
      });
      if (miembro.firma_path) {
        indexPorPath.set(miembro.firma_path, firmantes.length - 1);
        pathsAResolver.push(miembro.firma_path);
      }
    } else if (cargo === "tesorero") {
      firmantes.push({
        cargo: "tesorero",
        nombre: defaults.nombre,
        rut: defaults.rut,
        firmaUrl: null,
      });
    }
  }

  if (pathsAResolver.length > 0) {
    const supabase = await createSupabaseServerClient();
    const { data: signed } = await supabase.storage
      .from("firmas")
      .createSignedUrls(pathsAResolver, 3600);
    for (const s of signed ?? []) {
      const idx = indexPorPath.get(s.path ?? "");
      if (typeof idx === "number" && s.signedUrl) {
        firmantes[idx].firmaUrl = s.signedUrl;
      }
    }
  }

  return firmantes;
}
