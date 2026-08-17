"use server";

import { revalidatePath } from "next/cache";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCartola } from "@/lib/cartolas";

// Recibe la ruta del archivo ya subido a Storage por el cliente, lo descarga,
// lo parsea con el parser correcto segun el banco de la cuenta, y guarda la
// cartola + N cartola_lineas en la DB.
export async function importarCartola(input: {
  cuenta_id: string;
  archivo_path: string;
  archivo_nombre: string;
}): Promise<{ cartolaId: string; filas: number }> {
  const profile = await requireDirectiva();
  const supabase = await createSupabaseServerClient();

  const { data: cuenta } = await supabase
    .from("cuentas")
    .select("id, banco")
    .eq("id", input.cuenta_id)
    .single();
  if (!cuenta) throw new Error("Cuenta no encontrada.");
  if (!cuenta.banco) {
    throw new Error(
      "La cuenta no tiene banco configurado. Edítala primero en /cuentas."
    );
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from("cartolas")
    .download(input.archivo_path);
  if (dlErr || !blob) {
    throw new Error(
      `No pude leer el archivo subido: ${dlErr?.message ?? "sin datos"}`
    );
  }
  const buffer = await blob.arrayBuffer();

  let parseada;
  try {
    parseada = parseCartola(cuenta.banco, buffer);
  } catch (err) {
    // Limpiar el archivo subido si el parseo fallo, para no dejar basura.
    await supabase.storage.from("cartolas").remove([input.archivo_path]);
    throw err;
  }

  const { data: cartola, error: e1 } = await supabase
    .from("cartolas")
    .insert({
      cuenta_id: input.cuenta_id,
      banco: cuenta.banco,
      archivo_path: input.archivo_path,
      archivo_nombre: input.archivo_nombre,
      fecha_inicio: parseada.fecha_inicio,
      fecha_fin: parseada.fecha_fin,
      filas_total: parseada.lineas.length,
      saldo_inicial: parseada.saldo_inicial,
      saldo_final: parseada.saldo_final,
      subida_por: profile.id,
    })
    .select("id")
    .single();
  if (e1) {
    await supabase.storage.from("cartolas").remove([input.archivo_path]);
    throw new Error(e1.message);
  }

  const cartolaId = cartola.id as string;
  if (parseada.lineas.length > 0) {
    const rows = parseada.lineas.map((l) => ({
      cartola_id: cartolaId,
      fila_num: l.fila_num,
      fecha: l.fecha,
      descripcion: l.descripcion,
      monto: l.monto,
      tipo: l.tipo,
      canal: l.canal,
      saldo_despues: l.saldo_despues,
      referencia_externa: l.referencia_externa,
    }));
    const { error: e2 } = await supabase.from("cartola_lineas").insert(rows);
    if (e2) {
      throw new Error(
        `Cartola guardada pero fallaron las líneas: ${e2.message}`
      );
    }
  }

  revalidatePath("/cartolas");
  return { cartolaId, filas: parseada.lineas.length };
}

export async function eliminarCartola(id: string) {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data: cart } = await supabase
    .from("cartolas")
    .select("archivo_path")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("cartolas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if (cart?.archivo_path) {
    await supabase.storage.from("cartolas").remove([cart.archivo_path]);
  }
  revalidatePath("/cartolas");
  revalidatePath(`/cartolas/${id}`);
}

export async function getCartolaSignedUrl(path: string): Promise<string | null> {
  await requireDirectiva();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("cartolas")
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
