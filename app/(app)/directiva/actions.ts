"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DirectivaCargo } from "@/lib/types";

type CrearInput = {
  nombre: string;
  rut: string;
  cargo: DirectivaCargo;
  activo: boolean;
  orden?: number;
};

// Si el miembro nuevo va a quedar activo y ya existe otro activo con el mismo
// cargo, lo desactivamos primero (respeta la unique constraint parcial).
async function desactivarActivoDelCargo(cargo: DirectivaCargo) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("directiva_miembros")
    .update({ activo: false })
    .eq("cargo", cargo)
    .eq("activo", true);
  if (error) throw new Error(error.message);
}

export async function crearMiembroDirectiva(input: CrearInput) {
  await requireDirectiva();
  const nombre = input.nombre.trim();
  const rut = input.rut.trim();
  if (!nombre) throw new Error("Ingresa un nombre.");
  // RUT es opcional: si queda vacío, en el acta se imprime una línea en blanco
  // para completarlo a mano al momento de firmar.
  if (input.activo) await desactivarActivoDelCargo(input.cargo);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("directiva_miembros").insert({
    nombre,
    rut,
    cargo: input.cargo,
    activo: input.activo,
    orden: input.orden ?? 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

export async function actualizarMiembroDirectiva(
  id: string,
  patch: { nombre?: string; rut?: string; cargo?: DirectivaCargo }
) {
  await requireDirectiva();
  const clean: Record<string, unknown> = {};
  if (patch.nombre !== undefined) clean.nombre = patch.nombre.trim();
  if (patch.rut !== undefined) clean.rut = patch.rut.trim();
  if (patch.cargo !== undefined) clean.cargo = patch.cargo;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("directiva_miembros")
    .update(clean)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

// Activa o desactiva un miembro. Si activa uno, desactiva primero al que
// tenga el mismo cargo activo (garantiza unicidad).
export async function toggleMiembroDirectiva(id: string, activo: boolean) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  if (activo) {
    // Buscamos el cargo del target y desactivamos al que este activo con ese cargo.
    const { data: target } = await supabase
      .from("directiva_miembros")
      .select("cargo")
      .eq("id", id)
      .maybeSingle();
    if (target?.cargo) await desactivarActivoDelCargo(target.cargo as DirectivaCargo);
  }
  const { error } = await supabase
    .from("directiva_miembros")
    .update({ activo })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

export async function eliminarMiembroDirectiva(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("directiva_miembros")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/directiva");
}

// Procesa la imagen recibida quitando el fondo (papel) y dejando solo la
// tinta como PNG con transparencia. Mismos umbrales que scripts/procesar-firma.mjs.
async function limpiarFondoFirma(file: File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const { data, info } = await sharp(inputBuffer)
    .grayscale()
    .normalise()
    .median(1)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const out = Buffer.alloc(width * height * 4); // RGBA

  const LIGHT_CUTOFF = 110;
  const DARK_CUTOFF = 50;

  for (let i = 0; i < width * height; i++) {
    const gray = data[i];
    let alpha: number;
    if (gray >= LIGHT_CUTOFF) alpha = 0;
    else if (gray <= DARK_CUTOFF) alpha = 255;
    else
      alpha = Math.round(
        ((LIGHT_CUTOFF - gray) / (LIGHT_CUTOFF - DARK_CUTOFF)) * 255
      );
    out[i * 4] = 0;
    out[i * 4 + 1] = 0;
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = alpha;
  }

  return await sharp(out, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 5 })
    .png()
    .toBuffer();
}

// Sube (o reemplaza) la firma escaneada de un miembro. Procesa la imagen en el
// servidor para quitar el fondo antes de guardarla en Storage.
export async function subirFirmaMiembro(id: string, formData: FormData) {
  await requireDirectiva();
  const file = formData.get("firma");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Debes seleccionar un archivo de imagen.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("El archivo pesa más de 5 MB. Elige uno más liviano.");
  }

  const supabase = await createSupabaseServerClient();

  // Cargamos el miembro para leer la firma_path anterior (para borrarla).
  const { data: miembro, error: getErr } = await supabase
    .from("directiva_miembros")
    .select("id, firma_path")
    .eq("id", id)
    .maybeSingle();
  if (getErr) throw new Error(getErr.message);
  if (!miembro) throw new Error("Miembro no encontrado.");

  const cleanBuffer = await limpiarFondoFirma(file);
  const path = `${id}/${Date.now()}.png`;
  const { error: upErr } = await supabase.storage
    .from("firmas")
    .upload(path, cleanBuffer, {
      contentType: "image/png",
      upsert: false,
    });
  if (upErr) throw new Error(`Error al subir la firma: ${upErr.message}`);

  const { error: updErr } = await supabase
    .from("directiva_miembros")
    .update({ firma_path: path })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  // Borra la firma anterior si tenia una, para no acumular basura en Storage.
  if (miembro.firma_path && miembro.firma_path !== path) {
    await supabase.storage.from("firmas").remove([miembro.firma_path]);
  }

  revalidatePath("/directiva");
}

export async function eliminarFirmaMiembro(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: miembro, error: getErr } = await supabase
    .from("directiva_miembros")
    .select("id, firma_path")
    .eq("id", id)
    .maybeSingle();
  if (getErr) throw new Error(getErr.message);
  if (!miembro) throw new Error("Miembro no encontrado.");
  if (miembro.firma_path) {
    await supabase.storage.from("firmas").remove([miembro.firma_path]);
  }
  const { error: updErr } = await supabase
    .from("directiva_miembros")
    .update({ firma_path: null })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);
  revalidatePath("/directiva");
}

export async function getFirmaSignedUrl(path: string): Promise<string | null> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.storage
    .from("firmas")
    .createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
