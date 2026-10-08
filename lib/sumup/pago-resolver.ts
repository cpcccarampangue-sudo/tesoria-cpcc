// Resolver idempotente para /incorporacion/pago.
//
// Dado una socio_solicitud en pendiente_pago, devuelve una ResolucionCheckout
// que la UI usa para elegir que renderizar. Garantias:
//   - UN SOLO crearCheckout maximo por solicitud, incluso ante concurrencia.
//   - Nunca crea tras error transitorio (timeout, 429, 5xx, red).
//   - Nunca crea tras error fatal (401/403/422).
//   - Tras 404 reintenta y usa lookup por reference antes de versionar.
//   - Antes del POST (incluso con id null) consulta por reference para
//     adoptar checkouts huerfanos de intentos anteriores (crash/timeout).
//   - PAID devuelve payload live para que una rutina de reconciliacion
//     idempotente futura pueda invocarse.
//
// Ver matriz completa en el task que origino este archivo.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  crearCheckout,
  obtenerCheckout,
  listarCheckoutsPorReference,
  SumUpError,
  type CheckoutResp,
} from "./client";
import { siteUrl } from "@/lib/qr";
import type { SocioSolicitud } from "@/lib/types";
import {
  claimCheckoutCreacionLock,
  liberarCheckoutCreacionLock,
  leerSumupCheckoutIdFresco,
  persistirCheckoutIdCondicional,
} from "./pago-lock";

// Payload live que exponemos para reconciliacion. Suficiente para una
// rutina futura que marque DB como pagada + cree movimiento + envie correo.
export type PagoLivePayload = {
  checkout_id: string;
  status: "PAID";
  amount: number;
  currency: string;
  checkout_reference: string | null;
  transaction_id: string | null;
  transaction_code: string | null;
};

export type ResolucionCheckout =
  | { tipo: "pendiente_nuevo"; url: string }
  | { tipo: "pendiente_reutilizado"; url: string }
  | { tipo: "pendiente_versionado"; url: string }
  | { tipo: "pendiente_recuperado_409"; url: string }
  | { tipo: "pagada_live"; live: PagoLivePayload }
  | { tipo: "verificacion_temporal_no_disponible" }
  | { tipo: "mismatch"; detalle: string }
  | { tipo: "error_fatal"; detalle: string };

type GetLiveResult =
  | { kind: "ok"; live: CheckoutResp }
  | { kind: "not_found_confirmado" }
  | { kind: "transient" }
  | { kind: "fatal"; detalle: string };

type LookupResult =
  | { kind: "ok"; items: CheckoutResp[] }
  | { kind: "transient" }
  | { kind: "fatal"; detalle: string };

const LOG = "[pago-resolver]";

function logEvt(tag: string, extra?: Record<string, unknown>) {
  // tags normalizados (ver seccion 9 del task): checkout_creado,
  // checkout_existente_reutilizado, checkout_paid, checkout_terminal_reemplazado,
  // checkout_duplicado_recuperado, checkout_no_encontrado_reemplazado,
  // checkout_no_encontrado_reutilizado_por_reference,
  // checkout_verificacion_temporalmente_no_disponible, checkout_mismatch,
  // error_real_sumup.
  const safe = extra ? JSON.stringify(extra) : "";
  console.info(`${LOG} [${tag}] ${safe}`);
}

function clasificarError(err: unknown): "not_found" | "transient" | "fatal" {
  if (err instanceof SumUpError) {
    if (err.status === 404) return "not_found";
    if (err.status === 429) return "transient";
    if (err.status >= 500 && err.status < 600) return "transient";
    return "fatal";
  }
  if (err instanceof Error) {
    const name = err.name;
    if (name === "AbortError" || name === "TimeoutError") return "transient";
    if (name === "TypeError") return "transient";
  }
  return "transient"; // conservador: NUNCA creamos por un error desconocido
}

async function intentarGetLive(id: string): Promise<GetLiveResult> {
  try {
    const live = await obtenerCheckout(id);
    return { kind: "ok", live };
  } catch (err) {
    const c = clasificarError(err);
    if (c === "not_found") return { kind: "not_found_confirmado" }; // caller re-ejecuta
    if (c === "transient") return { kind: "transient" };
    return {
      kind: "fatal",
      detalle: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getLiveRobusto(id: string): Promise<GetLiveResult> {
  const r1 = await intentarGetLive(id);
  if (r1.kind !== "not_found_confirmado") return r1;
  await delay(300);
  const r2 = await intentarGetLive(id);
  if (r2.kind !== "not_found_confirmado") return r2;
  await delay(700);
  const r3 = await intentarGetLive(id);
  return r3; // puede ser not_found (3 veces -> confirmado) o cambio
}

async function lookupPorReference(ref: string): Promise<LookupResult> {
  try {
    const items = await listarCheckoutsPorReference(ref);
    return { kind: "ok", items };
  } catch (err) {
    const c = clasificarError(err);
    if (c === "transient") return { kind: "transient" };
    return {
      kind: "fatal",
      detalle: err instanceof Error ? err.message : String(err),
    };
  }
}

function coherente(
  live: CheckoutResp,
  s: SocioSolicitud
): { ok: boolean; detalle: string } {
  const expectedMerchant = process.env.SUMUP_MERCHANT_CODE;
  const refOk = (live.checkout_reference ?? "").startsWith(`socio_${s.id}`);
  const amountOk = Number(live.amount) === Number(s.monto_cuota);
  const currencyOk = live.currency === "CLP";
  const merchantOk =
    !expectedMerchant ||
    !live.merchant_code ||
    live.merchant_code === expectedMerchant;
  return {
    ok: refOk && amountOk && currencyOk && merchantOk,
    detalle: `refOk=${refOk} amountOk=${amountOk} currencyOk=${currencyOk} merchantOk=${merchantOk} liveRef=${live.checkout_reference} liveAmount=${live.amount} liveCurrency=${live.currency} liveStatus=${live.status}`,
  };
}

// Prioridad al elegir entre multiples checkouts de la misma reference:
// PAID > PENDING > terminal (FAILED/EXPIRED/CANCELED).
function seleccionarMejor(items: CheckoutResp[]): CheckoutResp | null {
  if (items.length === 0) return null;
  const paid = items.find((c) => c.status === "PAID");
  if (paid) return paid;
  const pending = items.find((c) => c.status === "PENDING");
  if (pending) return pending;
  return items[0]; // terminal
}

function urlFrom(live: CheckoutResp): string | null {
  return live.hosted_checkout_url ?? live.checkout_url ?? null;
}

function livePayload(live: CheckoutResp): PagoLivePayload {
  return {
    checkout_id: live.id,
    status: "PAID",
    amount: live.amount,
    currency: live.currency,
    checkout_reference: live.checkout_reference ?? null,
    transaction_id: live.transaction_id ?? null,
    transaction_code: live.transaction_code ?? null,
  };
}

function argsCrearCheckout(s: SocioSolicitud, checkoutReference: string) {
  return {
    checkoutReference,
    amount: s.monto_cuota,
    currency: "CLP" as const,
    description: `Cuota socio CdP ${s.periodo_anio} - ${s.apoderado_nombre}`,
    redirectUrl: `${siteUrl()}/incorporacion/pago?token=${s.qr_token}`,
    payToEmail: s.apoderado_email,
    payerName: s.apoderado_nombre,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Punto de entrada
// ============================================================
export async function resolverCheckoutIdempotente(
  admin: SupabaseClient,
  s: SocioSolicitud
): Promise<ResolucionCheckout> {
  // Limite de recursion defensivo (si checkout_changed ocurre repetidamente).
  return await resolverInterno(admin, s, 2);
}

async function resolverInterno(
  admin: SupabaseClient,
  s: SocioSolicitud,
  intentosRestantes: number
): Promise<ResolucionCheckout> {
  if (intentosRestantes <= 0) {
    logEvt("checkout_verificacion_temporalmente_no_disponible", {
      razon: "limite_iteraciones",
    });
    return { tipo: "verificacion_temporal_no_disponible" };
  }

  // === STAGE 1: estado inicial sin lock ===
  if (s.sumup_checkout_id) {
    const r = await getLiveRobusto(s.sumup_checkout_id);
    switch (r.kind) {
      case "transient":
        logEvt("checkout_verificacion_temporalmente_no_disponible", {
          origen: "get_live",
        });
        return { tipo: "verificacion_temporal_no_disponible" };
      case "fatal":
        logEvt("error_real_sumup", { origen: "get_live", detalle: r.detalle });
        return { tipo: "error_fatal", detalle: r.detalle };
      case "not_found_confirmado":
        logEvt("checkout_no_encontrado_reemplazado", {
          fase: "pre_lookup",
          id_mask: mask(s.sumup_checkout_id),
        });
        return await flujoLookupYCrear(
          admin,
          s,
          "versionado",
          intentosRestantes
        );
      case "ok": {
        const coh = coherente(r.live, s);
        if (!coh.ok) {
          logEvt("checkout_mismatch", { detalle: coh.detalle });
          return { tipo: "mismatch", detalle: coh.detalle };
        }
        if (r.live.status === "PENDING") {
          const url = urlFrom(r.live);
          if (!url) {
            logEvt("error_real_sumup", { razon: "pending_sin_hosted_url" });
            return {
              tipo: "error_fatal",
              detalle: "live PENDING sin hosted_checkout_url",
            };
          }
          logEvt("checkout_existente_reutilizado", { via: "get_live_pending" });
          return { tipo: "pendiente_reutilizado", url };
        }
        if (r.live.status === "PAID") {
          logEvt("checkout_paid", { via: "get_live" });
          return { tipo: "pagada_live", live: livePayload(r.live) };
        }
        // FAILED / EXPIRED / CANCELED
        logEvt("checkout_terminal_reemplazado", {
          live_status: r.live.status,
          fase: "pre_lookup",
        });
        return await flujoLookupYCrear(
          admin,
          s,
          "versionado",
          intentosRestantes
        );
      }
    }
  }

  // id null -> primera creacion, pero antes lookup por reference base
  return await flujoLookupYCrear(
    admin,
    s,
    "primera_creacion",
    intentosRestantes
  );
}

// Hace el lookup por reference antes de considerar crear. Si encuentra
// algo adoptable, lo adopta sin crear. Si no, pasa al claim+create.
async function flujoLookupYCrear(
  admin: SupabaseClient,
  s: SocioSolicitud,
  modo: "primera_creacion" | "versionado",
  intentosRestantes: number
): Promise<ResolucionCheckout> {
  const refBase = `socio_${s.id}`;
  const lookup = await lookupPorReference(refBase);

  if (lookup.kind === "transient") {
    logEvt("checkout_verificacion_temporalmente_no_disponible", {
      origen: "lookup_por_reference",
    });
    return { tipo: "verificacion_temporal_no_disponible" };
  }
  if (lookup.kind === "fatal") {
    logEvt("error_real_sumup", {
      origen: "lookup_por_reference",
      detalle: lookup.detalle,
    });
    return { tipo: "error_fatal", detalle: lookup.detalle };
  }
  // lookup.kind === "ok"
  const found = seleccionarMejor(lookup.items);
  if (found) {
    const coh = coherente(found, s);
    if (!coh.ok) {
      logEvt("checkout_mismatch", {
        origen: "lookup_por_reference",
        detalle: coh.detalle,
      });
      return { tipo: "mismatch", detalle: coh.detalle };
    }
    if (found.status === "PAID") {
      // Adoptar id si aun no lo tenemos.
      if (!s.sumup_checkout_id) {
        await persistirCheckoutIdCondicional(admin, s.id, null, found.id);
      } else if (s.sumup_checkout_id !== found.id) {
        await persistirCheckoutIdCondicional(
          admin,
          s.id,
          s.sumup_checkout_id,
          found.id
        );
      }
      logEvt("checkout_paid", { via: "lookup_por_reference" });
      return { tipo: "pagada_live", live: livePayload(found) };
    }
    if (found.status === "PENDING") {
      const url = urlFrom(found);
      if (!url) {
        logEvt("error_real_sumup", { razon: "lookup_pending_sin_hosted_url" });
        return {
          tipo: "error_fatal",
          detalle: "lookup PENDING sin hosted_checkout_url",
        };
      }
      // Adoptar id si aun no lo tenemos o es distinto.
      if (!s.sumup_checkout_id) {
        const r = await persistirCheckoutIdCondicional(
          admin,
          s.id,
          null,
          found.id
        );
        if (r === "perdido") {
          // Otro proceso cambio el id entre tanto. Re-resolver.
          const fresh = await releerSolicitud(admin, s.id);
          if (!fresh) return { tipo: "error_fatal", detalle: "solicitud desaparecida" };
          return await resolverInterno(admin, fresh, intentosRestantes - 1);
        }
      } else if (s.sumup_checkout_id !== found.id) {
        await persistirCheckoutIdCondicional(
          admin,
          s.id,
          s.sumup_checkout_id,
          found.id
        );
      }
      logEvt(
        modo === "primera_creacion"
          ? "checkout_existente_reutilizado"
          : "checkout_no_encontrado_reutilizado_por_reference",
        { via: "lookup_por_reference" }
      );
      return { tipo: "pendiente_reutilizado", url };
    }
    // found es terminal (FAILED/EXPIRED/CANCELED): no adoptar, versionar.
    logEvt("checkout_terminal_reemplazado", {
      live_status: found.status,
      via: "lookup_por_reference",
    });
    return await claimYCrear(admin, s, true, intentosRestantes);
  }

  // Lookup vacio: crear.
  const esVersionado = modo === "versionado";
  return await claimYCrear(admin, s, esVersionado, intentosRestantes);
}

async function releerSolicitud(
  admin: SupabaseClient,
  id: string
): Promise<SocioSolicitud | null> {
  const { data } = await admin
    .from("socio_solicitudes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as SocioSolicitud | null) ?? null;
}

async function claimYCrear(
  admin: SupabaseClient,
  s: SocioSolicitud,
  esVersionado: boolean,
  intentosRestantes: number
): Promise<ResolucionCheckout> {
  const expectedCurrentId = s.sumup_checkout_id ?? null;
  // Token unico por intento. Se mantiene hasta liberar en finally; si el
  // lock expira (TTL 30s) y otro proceso lo toma, nuestra liberar sera NO-OP
  // porque el token almacenado habra cambiado.
  const lockToken = crypto.randomUUID();
  const claim = await claimCheckoutCreacionLock(
    admin,
    s.id,
    expectedCurrentId,
    lockToken
  );

  if (claim === "checkout_changed") {
    const fresh = await releerSolicitud(admin, s.id);
    if (!fresh) return { tipo: "error_fatal", detalle: "solicitud desaparecida" };
    return await resolverInterno(admin, fresh, intentosRestantes - 1);
  }

  if (claim === "busy") {
    for (const espera of [300, 700, 1200]) {
      await delay(espera);
      const freshId = await leerSumupCheckoutIdFresco(admin, s.id);
      if (freshId !== expectedCurrentId) {
        const fresh = await releerSolicitud(admin, s.id);
        if (!fresh) return { tipo: "error_fatal", detalle: "solicitud desaparecida" };
        return await resolverInterno(admin, fresh, intentosRestantes - 1);
      }
    }
    logEvt("checkout_verificacion_temporalmente_no_disponible", {
      razon: "lock_busy_tras_polling",
    });
    return { tipo: "verificacion_temporal_no_disponible" };
  }

  // claim === "acquired": SOY el unico que puede crear.
  try {
    const ref = esVersionado
      ? `socio_${s.id}_r${Date.now()}`
      : `socio_${s.id}`;

    let checkout: CheckoutResp;
    try {
      checkout = await crearCheckout(argsCrearCheckout(s, ref));
    } catch (err) {
      if (err instanceof SumUpError && err.status === 409) {
        logEvt("checkout_duplicado_recuperado", {
          fase: "recuperacion_tras_409",
        });
        return await recuperarTras409(admin, s, expectedCurrentId);
      }
      const c = clasificarError(err);
      if (c === "transient") {
        logEvt("checkout_verificacion_temporalmente_no_disponible", {
          origen: "post_crear",
        });
        return { tipo: "verificacion_temporal_no_disponible" };
      }
      // fatal o not_found (no aplica a POST, pero por si acaso)
      const detalle = err instanceof Error ? err.message : String(err);
      logEvt("error_real_sumup", { origen: "post_crear", detalle });
      return { tipo: "error_fatal", detalle };
    }

    const url = urlFrom(checkout);
    if (!url) {
      logEvt("error_real_sumup", { razon: "post_ok_sin_hosted_url" });
      return {
        tipo: "error_fatal",
        detalle: "SumUp no devolvio hosted_checkout_url",
      };
    }

    const persist = await persistirCheckoutIdCondicional(
      admin,
      s.id,
      expectedCurrentId,
      checkout.id
    );
    if (persist === "perdido") {
      // Caso raro: tengo el lock pero el UPDATE condicional fallo. Significa
      // que otro proceso cambio sumup_checkout_id entre nuestro claim y
      // nuestra persistencia (no deberia pasar con RPC + SELECT FOR UPDATE,
      // pero defensivo). Re-resolver con fresh.
      logEvt("error_real_sumup", {
        razon: "persist_perdido_tras_acquire",
      });
      const fresh = await releerSolicitud(admin, s.id);
      if (!fresh) return { tipo: "error_fatal", detalle: "solicitud desaparecida" };
      return await resolverInterno(admin, fresh, intentosRestantes - 1);
    }

    logEvt(esVersionado ? "checkout_terminal_reemplazado" : "checkout_creado", {
      via: "post",
    });
    return {
      tipo: esVersionado ? "pendiente_versionado" : "pendiente_nuevo",
      url,
    };
  } finally {
    // Liberar con el token de este intento. Si el lock ya fue reemplazado
    // por otro proceso (TTL expirado), esta llamada es NO-OP a nivel DB
    // (la RPC exige WHERE lock_token = p_lock_token).
    await liberarCheckoutCreacionLock(admin, s.id, lockToken);
  }
}

async function recuperarTras409(
  admin: SupabaseClient,
  s: SocioSolicitud,
  expectedCurrentId: string | null
): Promise<ResolucionCheckout> {
  const refBase = `socio_${s.id}`;
  const lookup = await lookupPorReference(refBase);
  if (lookup.kind === "transient") {
    logEvt("checkout_verificacion_temporalmente_no_disponible", {
      origen: "post_409_recovery",
    });
    return { tipo: "verificacion_temporal_no_disponible" };
  }
  if (lookup.kind === "fatal") {
    logEvt("error_real_sumup", {
      origen: "post_409_recovery",
      detalle: lookup.detalle,
    });
    return { tipo: "error_fatal", detalle: lookup.detalle };
  }
  const found = seleccionarMejor(lookup.items);
  if (!found) {
    logEvt("error_real_sumup", { razon: "409_pero_lookup_vacio" });
    return { tipo: "error_fatal", detalle: "409 pero lookup por reference vacio" };
  }
  const coh = coherente(found, s);
  if (!coh.ok) {
    logEvt("checkout_mismatch", {
      origen: "post_409_recovery",
      detalle: coh.detalle,
    });
    return { tipo: "mismatch", detalle: coh.detalle };
  }
  if (found.status === "PAID") {
    if (expectedCurrentId !== found.id) {
      await persistirCheckoutIdCondicional(
        admin,
        s.id,
        expectedCurrentId,
        found.id
      );
    }
    logEvt("checkout_paid", { via: "post_409_recovery" });
    return { tipo: "pagada_live", live: livePayload(found) };
  }
  if (found.status === "PENDING") {
    const url = urlFrom(found);
    if (!url) {
      return {
        tipo: "error_fatal",
        detalle: "409 recovery PENDING sin hosted_url",
      };
    }
    if (expectedCurrentId !== found.id) {
      await persistirCheckoutIdCondicional(
        admin,
        s.id,
        expectedCurrentId,
        found.id
      );
    }
    logEvt("checkout_duplicado_recuperado", { via: "post_409_recovery" });
    return { tipo: "pendiente_recuperado_409", url };
  }
  // terminal tras 409: NO re-crear automaticamente (evita loop).
  logEvt("error_real_sumup", {
    razon: `409_mas_${found.status}`,
  });
  return {
    tipo: "error_fatal",
    detalle: `409 + checkout en ${found.status}`,
  };
}

function mask(id: string | null): string {
  if (!id) return "<null>";
  return id.length <= 8 ? "***" : `${id.slice(0, 8)}…`;
}
