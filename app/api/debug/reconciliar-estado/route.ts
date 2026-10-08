// Endpoint admin-only DRY-RUN para auditar el estado de una
// socio_solicitud antes de reconciliar. SIN side-effects: solo lecturas.
//
// Protegido con requireDirectiva. Service role server-side.
//
// Uso:
//   GET /api/debug/reconciliar-estado?solicitud_id=<uuid>
//   GET /api/debug/reconciliar-estado?checkout_id=<id>
//
// Devuelve JSON enmascarado con:
//   - solicitud en DB
//   - live SumUp (status, amount, currency, merchant, reference)
//   - validaciones de coherencia (refOk, amountOk, currencyOk, merchantOk)
//   - movimiento linkeado si existe
//   - apoderado linkeado si existe
//   - efectos ya aplicados / faltantes
//   - "plan" de lo que haria la reconciliacion

import { NextResponse, type NextRequest } from "next/server";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { obtenerCheckout, SumUpError } from "@/lib/sumup/client";
import type { SocioSolicitud } from "@/lib/types";

export const dynamic = "force-dynamic";

function maskId(id: string | null | undefined): string {
  if (!id) return "<null>";
  return id.length <= 8 ? "***" : `${id.slice(0, 8)}…`;
}
function maskEmail(e: string | null | undefined): string {
  if (!e) return "<null>";
  const at = e.indexOf("@");
  if (at < 1) return "***";
  const user = e.slice(0, at);
  const dom = e.slice(at + 1);
  return (
    (user.length <= 2 ? "*" : user[0] + "***") +
    "@" +
    (dom.length <= 2 ? "*" : dom[0] + "***")
  );
}
function maskName(n: string | null | undefined): string {
  if (!n) return "<null>";
  return n
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : w[0] + "***"))
    .join(" ");
}

export async function GET(req: NextRequest) {
  await requireDirectiva();

  const url = new URL(req.url);
  const solicitudIdParam = url.searchParams.get("solicitud_id");
  const checkoutIdParam = url.searchParams.get("checkout_id");

  if (!solicitudIdParam && !checkoutIdParam) {
    return NextResponse.json(
      { ok: false, error: "requiere ?solicitud_id=<uuid> o ?checkout_id=<id>" },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const q = admin.from("socio_solicitudes").select("*");
  const { data: solData } = solicitudIdParam
    ? await q.eq("id", solicitudIdParam).maybeSingle()
    : await q.eq("sumup_checkout_id", checkoutIdParam as string).maybeSingle();
  const solicitud = (solData as SocioSolicitud | null) ?? null;
  if (!solicitud) {
    return NextResponse.json(
      { ok: false, error: "solicitud no encontrada" },
      { status: 404 }
    );
  }

  // Snapshot enmascarado de la solicitud + apoderado + movimiento.
  const { data: apRow } = solicitud.apoderado_id
    ? await admin
        .from("apoderados")
        .select("socio, socio_periodo, qr_token")
        .eq("id", solicitud.apoderado_id)
        .maybeSingle()
    : { data: null };
  const apoderado = apRow as {
    socio: boolean;
    socio_periodo: number | null;
    qr_token: string | null;
  } | null;

  const { data: movData } = await admin
    .from("movimientos")
    .select("id, fecha, tipo, monto, descripcion, cuenta_id, categoria_id, socio_solicitud_id")
    .eq("socio_solicitud_id", solicitud.id)
    .maybeSingle();
  const movLinked = movData as
    | {
        id: string;
        fecha: string;
        tipo: string;
        monto: number;
        descripcion: string;
        cuenta_id: string | null;
        categoria_id: string | null;
      }
    | null;

  // GET live.
  let liveSnapshot: Record<string, unknown> | null = null;
  let liveError: { status?: number; message: string } | null = null;
  if (solicitud.sumup_checkout_id) {
    try {
      const live = await obtenerCheckout(solicitud.sumup_checkout_id);
      liveSnapshot = {
        id_mask: maskId(live.id),
        checkout_reference_mask: live.checkout_reference
          ? live.checkout_reference.replace(
              /^socio_([^_]+)/,
              (_, u: string) => `socio_${maskId(u)}`
            )
          : null,
        status: live.status,
        amount: live.amount,
        currency: live.currency,
        merchant_code: live.merchant_code ?? null,
        tiene_transaction_id: live.transaction_id != null,
        tiene_transaction_code: live.transaction_code != null,
      };
    } catch (err) {
      liveError =
        err instanceof SumUpError
          ? { status: err.status, message: err.message }
          : { message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Coherencia (si tenemos live).
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE ?? null;
  const coherencia = liveSnapshot
    ? {
        refOk:
          typeof liveSnapshot.checkout_reference_mask === "string" &&
          liveSnapshot.checkout_reference_mask.startsWith(
            `socio_${solicitud.id.slice(0, 8)}…`
          ),
        amountOk: liveSnapshot.amount === solicitud.monto_cuota,
        currencyOk: liveSnapshot.currency === "CLP",
        merchantOk:
          !expectedMerchant ||
          !liveSnapshot.merchant_code ||
          liveSnapshot.merchant_code === expectedMerchant,
        statusOk: liveSnapshot.status === "PAID",
      }
    : null;

  const efectosYaAplicados: string[] = [];
  const efectosFaltantes: string[] = [];

  if (solicitud.estado === "pagada" || solicitud.estado === "enviada")
    efectosYaAplicados.push("solicitud.estado=pagada o enviada");
  else efectosFaltantes.push("solicitud.estado -> pagada");

  if (solicitud.sumup_transaction_id)
    efectosYaAplicados.push("solicitud.sumup_transaction_id");
  else efectosFaltantes.push("solicitud.sumup_transaction_id (del live)");

  if (solicitud.movimiento_id || movLinked)
    efectosYaAplicados.push("movimiento linkeado");
  else efectosFaltantes.push("INSERT movimientos (ingreso)");

  if (solicitud.pagada_en) efectosYaAplicados.push("solicitud.pagada_en");
  else efectosFaltantes.push("solicitud.pagada_en");

  if (solicitud.email_enviado_en) efectosYaAplicados.push("correo enviado");
  else efectosFaltantes.push("correo con QR");

  if (apoderado?.socio === true) efectosYaAplicados.push("apoderado.socio=true");
  else if (solicitud.apoderado_id) efectosFaltantes.push("apoderado.socio=true");

  if (
    apoderado?.socio_periodo != null &&
    apoderado.socio_periodo >= solicitud.periodo_anio
  )
    efectosYaAplicados.push(
      `apoderado.socio_periodo>=${solicitud.periodo_anio}`
    );
  else if (solicitud.apoderado_id)
    efectosFaltantes.push(
      `apoderado.socio_periodo := GREATEST(actual, ${solicitud.periodo_anio})`
    );

  if (apoderado?.qr_token) efectosYaAplicados.push("apoderado.qr_token");
  else if (solicitud.apoderado_id)
    efectosFaltantes.push("apoderado.qr_token (nuevo UUID)");

  const planReconciliacion: string[] = [];
  if (!liveSnapshot) {
    planReconciliacion.push(
      "GET live fallo o solicitud sin sumup_checkout_id — NO ejecutar"
    );
  } else if (!coherencia?.statusOk) {
    planReconciliacion.push(
      `live.status=${liveSnapshot.status} — NO ejecutar (requiere PAID)`
    );
  } else if (
    !coherencia?.refOk ||
    !coherencia?.amountOk ||
    !coherencia?.currencyOk ||
    !coherencia?.merchantOk
  ) {
    planReconciliacion.push("coherencia falla — NO ejecutar (mismatch)");
  } else {
    if (efectosFaltantes.length === 0) {
      planReconciliacion.push(
        "nada que hacer: todos los efectos ya aplicados (idempotente devolveria ya_reconciliada)"
      );
    } else {
      planReconciliacion.push(
        "aplicaria: " + efectosFaltantes.join(", ")
      );
    }
  }

  return NextResponse.json({
    ok: true,
    modo: "dry_run",
    solicitud: {
      id_mask: maskId(solicitud.id),
      qr_token_mask: maskId(solicitud.qr_token),
      estado: solicitud.estado,
      periodo_anio: solicitud.periodo_anio,
      monto_cuota: solicitud.monto_cuota,
      sumup_checkout_id: solicitud.sumup_checkout_id,
      tiene_sumup_transaction_id: solicitud.sumup_transaction_id != null,
      tiene_sumup_transaction_code: solicitud.sumup_transaction_code != null,
      pagada_en: solicitud.pagada_en,
      email_enviado_en: solicitud.email_enviado_en,
      email_reenvios: solicitud.email_reenvios,
      tipo_correo: solicitud.tipo_correo,
      movimiento_id_mask: maskId(solicitud.movimiento_id),
      apoderado_id_mask: maskId(solicitud.apoderado_id),
      apoderado_email_mask: maskEmail(solicitud.apoderado_email),
      apoderado_nombre_mask: maskName(solicitud.apoderado_nombre),
    },
    apoderado: apoderado
      ? {
          socio: apoderado.socio,
          socio_periodo: apoderado.socio_periodo,
          tiene_qr_token: apoderado.qr_token != null,
          qr_token_mask: maskId(apoderado.qr_token),
        }
      : null,
    movimiento_linkeado: movLinked
      ? {
          id_mask: maskId(movLinked.id),
          fecha: movLinked.fecha,
          tipo: movLinked.tipo,
          monto: movLinked.monto,
          cuenta_id_mask: maskId(movLinked.cuenta_id),
          categoria_id_mask: maskId(movLinked.categoria_id),
        }
      : null,
    sumup_live: liveSnapshot,
    sumup_live_error: liveError,
    coherencia,
    efectos_ya_aplicados: efectosYaAplicados,
    efectos_faltantes: efectosFaltantes,
    plan_reconciliacion: planReconciliacion,
    nota: "Dry-run: SIN side-effects. Para ejecutar la reconciliacion: POST /api/debug/reconciliar-pago",
  });
}
