// Reconciliacion idempotente de un pago SumUp PAID -> socio_solicitud.
//
// Punto unico de entrada compartido por:
//   - app/api/webhooks/sumup/route.ts (procesarSocio)
//   - app/api/debug/reconciliar-pago/route.ts (admin-only)
//   - futura recuperacion automatica (cron, reintentos)
//
// Flujo:
//   1. Validar contra SumUp live (GET /checkouts/{id}) con reintentos.
//   2. Chequear status=PAID + coherencia.
//   3. Invocar RPC transaccional reconciliar_pago_socio_core (migracion 035)
//      que ejecuta todo el nucleo DB con SELECT FOR UPDATE y repara
//      estados parciales.
//   4. Fuera de la tx DB: enviar correo via enviarCorreoQrSocio(id, {soloSiNoEnviado:true}).
//      El claim atomico de email + check email_enviado_en impiden duplicados.
//      Si SMTP falla, el pago queda bien en DB y el correo puede reintentarse
//      en la proxima ejecucion.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  obtenerCheckout,
  SumUpError,
  type CheckoutResp,
} from "@/lib/sumup/client";
import type { SocioSolicitud } from "@/lib/types";
import { enviarCorreoQrSocioIdempotente } from "@/lib/socios/enviar-qr";

export type ReconciliacionCore = {
  resultado:
    | "reconciliada"
    | "ya_reconciliada"
    | "mismatch"
    | "solicitud_no_encontrada";
  detalle: string | null;
  movimiento_id: string | null;
  estado_final: string | null;
  movimiento_creado: boolean;
  qr_generado: boolean;
  socio_actualizado: boolean;
  socio_periodo_actualizado: boolean;
};

export type ReconciliacionResult =
  | {
      resultado: "reconciliada";
      core: ReconciliacionCore;
      correo: "enviado" | "ya_enviado" | "busy_otro_proceso" | "fallo";
      correo_detalle: string | null;
    }
  | {
      resultado: "ya_reconciliada";
      core: ReconciliacionCore;
      correo: "enviado" | "ya_enviado" | "busy_otro_proceso" | "fallo" | "omitido";
      correo_detalle: string | null;
    }
  | {
      resultado: "mismatch";
      core: ReconciliacionCore;
    }
  | {
      resultado: "no_paid";
      live_status: CheckoutResp["status"] | "NOT_FOUND";
    }
  | {
      resultado: "sumup_no_disponible";
      detalle: string;
    }
  | {
      resultado: "solicitud_no_encontrada";
    };

type GetLiveOut =
  | { kind: "ok"; live: CheckoutResp }
  | { kind: "not_found_confirmado" }
  | { kind: "transient"; detalle: string }
  | { kind: "fatal"; detalle: string };

function clasificar(err: unknown): "not_found" | "transient" | "fatal" {
  if (err instanceof SumUpError) {
    if (err.status === 404) return "not_found";
    if (err.status === 429) return "transient";
    if (err.status >= 500 && err.status < 600) return "transient";
    return "fatal";
  }
  if (err instanceof Error) {
    const n = err.name;
    if (n === "AbortError" || n === "TimeoutError" || n === "TypeError")
      return "transient";
  }
  return "transient";
}

async function intentarGetLive(id: string): Promise<GetLiveOut> {
  try {
    const live = await obtenerCheckout(id);
    return { kind: "ok", live };
  } catch (err) {
    const c = clasificar(err);
    const detalle = err instanceof Error ? err.message : String(err);
    if (c === "not_found") return { kind: "not_found_confirmado" };
    if (c === "transient") return { kind: "transient", detalle };
    return { kind: "fatal", detalle };
  }
}

async function getLiveRobusto(id: string): Promise<GetLiveOut> {
  const r1 = await intentarGetLive(id);
  if (r1.kind !== "not_found_confirmado") return r1;
  await new Promise((r) => setTimeout(r, 300));
  const r2 = await intentarGetLive(id);
  if (r2.kind !== "not_found_confirmado") return r2;
  await new Promise((r) => setTimeout(r, 700));
  return await intentarGetLive(id);
}

export async function reconciliarPagoSocio(
  admin: SupabaseClient,
  args:
    | { modo: "por_solicitud_id"; solicitudId: string }
    | { modo: "por_checkout_id"; checkoutId: string }
    | { modo: "por_live"; solicitudId: string; live: CheckoutResp }
): Promise<ReconciliacionResult> {
  // 1) Resolver solicitud + live.
  let solicitud: SocioSolicitud | null = null;
  let live: CheckoutResp | null = null;

  if (args.modo === "por_live") {
    live = args.live;
    const { data } = await admin
      .from("socio_solicitudes")
      .select("*")
      .eq("id", args.solicitudId)
      .maybeSingle();
    solicitud = (data as SocioSolicitud | null) ?? null;
  } else if (args.modo === "por_solicitud_id") {
    const { data } = await admin
      .from("socio_solicitudes")
      .select("*")
      .eq("id", args.solicitudId)
      .maybeSingle();
    solicitud = (data as SocioSolicitud | null) ?? null;
  } else {
    const { data } = await admin
      .from("socio_solicitudes")
      .select("*")
      .eq("sumup_checkout_id", args.checkoutId)
      .maybeSingle();
    solicitud = (data as SocioSolicitud | null) ?? null;
  }

  if (!solicitud) {
    return { resultado: "solicitud_no_encontrada" };
  }

  if (!live) {
    if (!solicitud.sumup_checkout_id) {
      return {
        resultado: "mismatch",
        core: {
          resultado: "mismatch",
          detalle: "solicitud sin sumup_checkout_id",
          movimiento_id: null,
          estado_final: solicitud.estado,
          movimiento_creado: false,
          qr_generado: false,
          socio_actualizado: false,
          socio_periodo_actualizado: false,
        },
      };
    }
    const r = await getLiveRobusto(solicitud.sumup_checkout_id);
    if (r.kind === "transient") {
      return { resultado: "sumup_no_disponible", detalle: r.detalle };
    }
    if (r.kind === "fatal") {
      return { resultado: "sumup_no_disponible", detalle: r.detalle };
    }
    if (r.kind === "not_found_confirmado") {
      return { resultado: "no_paid", live_status: "NOT_FOUND" };
    }
    live = r.live;
  }

  // 2) status=PAID obligatorio.
  if (live.status !== "PAID") {
    return { resultado: "no_paid", live_status: live.status };
  }

  // 3) Invocar RPC core (SELECT FOR UPDATE + repara estados parciales).
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE ?? null;
  const { data: coreData, error: coreErr } = await admin.rpc(
    "reconciliar_pago_socio_core",
    {
      p_solicitud_id: solicitud.id,
      p_live_checkout_id: live.id,
      p_live_amount: live.amount,
      p_live_currency: live.currency,
      p_live_merchant_code: live.merchant_code ?? null,
      p_live_checkout_reference: live.checkout_reference ?? null,
      p_live_transaction_id: live.transaction_id ?? null,
      p_live_transaction_code: live.transaction_code ?? null,
      p_expected_merchant_code: expectedMerchant,
    }
  );
  if (coreErr) {
    throw new Error(`reconciliar_pago_socio_core RPC fallo: ${coreErr.message}`);
  }
  const row = Array.isArray(coreData) ? coreData[0] : coreData;
  if (!row) {
    throw new Error("reconciliar_pago_socio_core devolvio vacio");
  }
  const core: ReconciliacionCore = {
    resultado: row.resultado,
    detalle: row.detalle ?? null,
    movimiento_id: row.movimiento_id ?? null,
    estado_final: row.estado_final ?? null,
    movimiento_creado: row.movimiento_creado === true,
    qr_generado: row.qr_generado === true,
    socio_actualizado: row.socio_actualizado === true,
    socio_periodo_actualizado: row.socio_periodo_actualizado === true,
  };

  if (core.resultado === "solicitud_no_encontrada") {
    return { resultado: "solicitud_no_encontrada" };
  }
  if (core.resultado === "mismatch") {
    return { resultado: "mismatch", core };
  }

  // 4) Correo fuera de la tx. Protegido por claim_email_envio_lock
  // + check email_enviado_en en enviar-qr.
  let correo: "enviado" | "ya_enviado" | "busy_otro_proceso" | "fallo" = "fallo";
  let correoDetalle: string | null = null;
  try {
    const r = await enviarCorreoQrSocioIdempotente(admin, solicitud.id);
    if (r.ok && r.enviado) correo = "enviado";
    else if (r.ok && !r.enviado && r.motivo === "ya_enviado") correo = "ya_enviado";
    else if (r.ok && !r.enviado && r.motivo === "busy_otro_proceso")
      correo = "busy_otro_proceso";
    else if (!r.ok) {
      correo = "fallo";
      correoDetalle = r.error;
    }
  } catch (err) {
    correo = "fallo";
    correoDetalle = err instanceof Error ? err.message : String(err);
  }

  if (core.resultado === "ya_reconciliada") {
    return { resultado: "ya_reconciliada", core, correo, correo_detalle: correoDetalle };
  }
  return { resultado: "reconciliada", core, correo, correo_detalle: correoDetalle };
}
