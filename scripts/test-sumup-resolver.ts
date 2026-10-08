// Tests offline del resolver de /incorporacion/pago.
// Ejecutar: npx tsx scripts/test-sumup-resolver.ts
//
// NO toca Supabase ni SumUp reales. Mock de ambos con estado en memoria.
// Las operaciones DB se modelan como funciones sincronas (dentro de una
// Promise.resolve) para simular la atomicidad real del UPDATE/RPC.
//
// Cubre la matriz completa + concurrencia + timeout POST con lookup
// recuperado. Si algun test crea un segundo checkout cuando no debe,
// el assert explota.

import { resolverCheckoutIdempotente } from "../lib/sumup/pago-resolver";
import { SumUpError, type CheckoutResp } from "../lib/sumup/client";
import type { SocioSolicitud } from "../lib/types";

// ========================================================
// Mocks de SumUp (reemplazan los imports del cliente real)
// ========================================================
type MockSumUpState = {
  // "mundo" de SumUp: todos los checkouts creados, keyed por id.
  checkouts: Map<string, CheckoutResp>;
  // Programacion de respuestas por operacion (en orden FIFO):
  // next() devuelve la proxima accion para esa operacion.
  programGetLive: Array<GetAction>;
  programCrear: Array<CrearAction>;
  programLookup: Array<LookupAction>;
  // Contadores (lo clave para los asserts)
  callsGetLive: number;
  callsCrear: number;
  callsLookup: number;
};

type GetAction =
  | { kind: "ok"; status: CheckoutResp["status"]; refOverride?: string; amountOverride?: number }
  | { kind: "throw"; error: Error };
type CrearAction =
  | { kind: "ok"; registraEnMundo: boolean }
  | { kind: "throw"; error: Error };
type LookupAction =
  | { kind: "ok"; devolver: "mundo_por_ref" | "vacio" | "lista_custom"; custom?: CheckoutResp[] }
  | { kind: "throw"; error: Error };

const sumup: MockSumUpState = {
  checkouts: new Map(),
  programGetLive: [],
  programCrear: [],
  programLookup: [],
  callsGetLive: 0,
  callsCrear: 0,
  callsLookup: 0,
};

function resetSumUp() {
  sumup.checkouts.clear();
  sumup.programGetLive = [];
  sumup.programCrear = [];
  sumup.programLookup = [];
  sumup.callsGetLive = 0;
  sumup.callsCrear = 0;
  sumup.callsLookup = 0;
}

// Interceptamos fetch global para que las llamadas del cliente real
// (crearCheckout, obtenerCheckout, listarCheckoutsPorReference) reciban
// las respuestas programadas aqui, sin golpear SumUp real. Esto permite
// que el cliente de produccion (incluyendo AbortSignal, headers, body
// serialization) se ejercite tal cual.
const SUMUP_HOST = "https://api.sumup.com/v0.1";
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(SUMUP_HOST)) {
    return originalFetch(input as RequestInfo, init);
  }
  const path = url.slice(SUMUP_HOST.length);
  const method = (init.method ?? "GET").toUpperCase();

  // POST /checkouts
  if (method === "POST" && path === "/checkouts") {
    sumup.callsCrear++;
    const action = sumup.programCrear.shift();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (!action)
      throw new Error(
        `mock crearCheckout agotado (ref=${body.checkout_reference})`
      );
    if (action.kind === "throw") {
      const err = action.error;
      const simuladoLlego = (err as Error & { __simuloCreadoEnMundo?: boolean })
        .__simuloCreadoEnMundo;
      if (simuladoLlego) {
        const nuevo: CheckoutResp = {
          id: `chk_${Math.random().toString(36).slice(2, 10)}`,
          checkout_reference: body.checkout_reference,
          amount: body.amount,
          currency: "CLP",
          merchant_code: "MCTEST",
          status: "PENDING",
          hosted_checkout_url: `https://checkout.sumup.com/${body.checkout_reference}`,
        };
        sumup.checkouts.set(nuevo.id, nuevo);
      }
      // Si es SumUpError, convertirlo a Response con status.
      if (err && (err as Error).name === "SumUpError") {
        const sErr = err as SumUpError;
        return new Response(sErr.bodyText || "{}", {
          status: sErr.status,
          statusText: "err",
        });
      }
      throw err; // AbortError, TypeError, etc
    }
    const nuevo: CheckoutResp = {
      id: `chk_${Math.random().toString(36).slice(2, 10)}`,
      checkout_reference: body.checkout_reference,
      amount: body.amount,
      currency: body.currency ?? "CLP",
      merchant_code: body.merchant_code ?? "MCTEST",
      status: "PENDING",
      hosted_checkout_url: `https://checkout.sumup.com/${body.checkout_reference}`,
    };
    if (action.registraEnMundo) sumup.checkouts.set(nuevo.id, nuevo);
    return new Response(JSON.stringify(nuevo), { status: 200 });
  }

  // GET /checkouts/{id}
  const matchGet = path.match(/^\/checkouts\/([^?]+)$/);
  if (method === "GET" && matchGet) {
    sumup.callsGetLive++;
    const id = matchGet[1];
    const action = sumup.programGetLive.shift();
    if (!action) throw new Error(`mock obtenerCheckout agotado (id=${id})`);
    if (action.kind === "throw") {
      const err = action.error;
      if (err && (err as Error).name === "SumUpError") {
        const sErr = err as SumUpError;
        return new Response(sErr.bodyText || "{}", {
          status: sErr.status,
          statusText: "err",
        });
      }
      throw err;
    }
    const existing = sumup.checkouts.get(id);
    const resp: CheckoutResp = existing
      ? { ...existing, status: action.status }
      : {
          id,
          checkout_reference: action.refOverride ?? "unknown",
          amount: action.amountOverride ?? 0,
          currency: "CLP",
          merchant_code: "MCTEST",
          status: action.status,
        };
    return new Response(JSON.stringify(resp), { status: 200 });
  }

  // GET /checkouts?checkout_reference=...
  if (method === "GET" && path.startsWith("/checkouts?")) {
    sumup.callsLookup++;
    const refParam = new URL(url).searchParams.get("checkout_reference") ?? "";
    const action = sumup.programLookup.shift();
    if (!action) throw new Error(`mock lookup agotado (ref=${refParam})`);
    if (action.kind === "throw") {
      const err = action.error;
      if (err && (err as Error).name === "SumUpError") {
        const sErr = err as SumUpError;
        return new Response(sErr.bodyText || "{}", {
          status: sErr.status,
          statusText: "err",
        });
      }
      throw err;
    }
    let items: CheckoutResp[] = [];
    if (action.devolver === "vacio") items = [];
    else if (action.devolver === "lista_custom") items = action.custom ?? [];
    else
      items = Array.from(sumup.checkouts.values()).filter(
        (c) => c.checkout_reference === refParam
      );
    return new Response(JSON.stringify(items), { status: 200 });
  }

  return new Response("mock no route: " + method + " " + path, { status: 500 });
}) as typeof fetch;

// ========================================================
// Mock de Supabase admin (estado en memoria, atomico)
// ========================================================
// FilaDB = SocioSolicitud completa + lock column. El mock mantiene todos
// los campos para que releerSolicitud() devuelva un SocioSolicitud valido
// (y no un pseudo-objeto que rompa coherente() por monto_cuota undefined).
type FilaDB = SocioSolicitud & {
  checkout_creacion_lock_at: string | null;
  checkout_creacion_lock_token: string | null;
};

function mockAdmin(filas: FilaDB[]) {
  const state = new Map<string, FilaDB>(filas.map((f) => [f.id, { ...f }]));

  return {
    _state: state,
    from(table: string) {
      if (table !== "socio_solicitudes") {
        throw new Error(`mockAdmin: tabla no soportada ${table}`);
      }
      type Builder = {
        _mode: "select" | "update";
        _patch?: Record<string, unknown>;
        _filters: Array<(f: FilaDB) => boolean>;
        _cols: string[];
        select: (cols: string) => Builder;
        update: (patch: Record<string, unknown>) => Builder;
        eq: (col: string, val: unknown) => Builder;
        is: (col: string, val: unknown) => Builder;
        or: (expr: string) => Builder;
        maybeSingle: () => Promise<{ data: FilaDB | null; error: null }>;
        then: (
          resolve: (v: { data: FilaDB[]; error: null }) => unknown
        ) => Promise<unknown>;
      };
      const b: Builder = {
        _mode: "select",
        _filters: [],
        _cols: [],
        select(cols: string) {
          this._cols = cols.split(",").map((c) => c.trim());
          return this;
        },
        update(patch: Record<string, unknown>) {
          this._mode = "update";
          this._patch = patch;
          return this;
        },
        eq(col: string, val: unknown) {
          this._filters.push((f) => (f as unknown as Record<string, unknown>)[col] === val);
          return this;
        },
        is(col: string, val: unknown) {
          this._filters.push(
            (f) =>
              (f as unknown as Record<string, unknown>)[col] === (val as unknown)
          );
          return this;
        },
        or(_expr: string) {
          return this;
        },
        async maybeSingle() {
          const match = Array.from(state.values()).find((f) =>
            this._filters.every((p) => p(f))
          );
          return { data: match ? { ...match } : null, error: null };
        },
        then(resolve) {
          // Ejecucion sincrona del update/select-array.
          const matches = Array.from(state.values()).filter((f) =>
            this._filters.every((p) => p(f))
          );
          if (this._mode === "update" && this._patch) {
            for (const m of matches) {
              const cur = state.get(m.id)!;
              Object.assign(cur, this._patch);
            }
          }
          return Promise.resolve(
            resolve({ data: matches.map((m) => ({ ...m })), error: null })
          );
        },
      };
      return b;
    },
    async rpc(name: string, params: Record<string, unknown>) {
      // Semantica SINCRONA (sin await interno) para simular la atomicidad
      // de SELECT FOR UPDATE + UPDATE dentro de la RPC transaccional real.
      if (name === "claim_checkout_creacion_lock") {
        const id = params.p_solicitud_id as string;
        const expected = (params.p_expected_checkout_id ?? null) as
          | string
          | null;
        const token = params.p_lock_token as string;
        const fila = state.get(id);
        if (!fila) return { data: "checkout_changed", error: null };
        if ((fila.sumup_checkout_id ?? null) !== expected)
          return { data: "checkout_changed", error: null };
        if (
          fila.checkout_creacion_lock_at &&
          new Date(fila.checkout_creacion_lock_at).getTime() >
            Date.now() - 30_000
        ) {
          return { data: "busy", error: null };
        }
        // Lock libre o expirado: sobrescribimos at + token.
        fila.checkout_creacion_lock_at = new Date().toISOString();
        fila.checkout_creacion_lock_token = token;
        return { data: "acquired", error: null };
      }
      if (name === "liberar_checkout_creacion_lock") {
        const id = params.p_solicitud_id as string;
        const token = params.p_lock_token as string;
        const fila = state.get(id);
        if (!fila) return { data: false, error: null };
        if (fila.checkout_creacion_lock_token !== token)
          return { data: false, error: null };
        fila.checkout_creacion_lock_at = null;
        fila.checkout_creacion_lock_token = null;
        return { data: true, error: null };
      }
      throw new Error(`mockAdmin.rpc desconocido: ${name}`);
    },
  };
}

// ========================================================
// Helpers de test
// ========================================================
function makeFila(s: SocioSolicitud, lock: string | null = null): FilaDB {
  return {
    ...s,
    checkout_creacion_lock_at: lock,
    checkout_creacion_lock_token: null,
  };
}

function makeSolicitud(overrides: Partial<SocioSolicitud> = {}): SocioSolicitud {
  const base: SocioSolicitud = {
    id: "11111111-1111-1111-1111-111111111111",
    qr_token: "22222222-2222-2222-2222-222222222222",
    periodo_anio: 2027,
    apoderado_id: null,
    apoderado_nombre: "Familia Test",
    apoderado_email: "familia.test@example.cl",
    apoderado_rut: null,
    apoderado_telefono: null,
    alumno_nombre: "Alumno Test",
    curso: "1° Básico A",
    monto_cuota: 18500,
    sumup_checkout_id: null,
    sumup_transaction_id: null,
    sumup_transaction_code: null,
    movimiento_id: null,
    pagada_en: null,
    email_enviado_en: null,
    email_reenvios: 0,
    estado: "pendiente_pago",
    notas_internas: null,
    procesada_por: null,
    tipo_correo: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

type TestRow = { nombre: string; ok: boolean; detalle?: string };
const results: TestRow[] = [];
function assert(nombre: string, cond: boolean, detalle = "") {
  results.push({ nombre, ok: cond, detalle });
  const icon = cond ? "✓" : "✗";
  console.log(`  ${icon} ${nombre}${detalle ? " — " + detalle : ""}`);
}

// Fuerza AbortError (clasificado como transient).
function abortError(): Error {
  const e = new Error("fetch aborted");
  e.name = "AbortError";
  return e;
}
// Fuerza TypeError (red; transient).
function networkError(): Error {
  return new TypeError("fetch failed");
}
// SumUpError helper
function sumupErr(status: number, body = "{}", msg = "err"): SumUpError {
  return new SumUpError({
    status,
    bodyText: body,
    path: "/checkouts",
    method: "POST",
    detail: msg,
  });
}

process.env.SUMUP_API_KEY = "test_api_key_mock";
process.env.SUMUP_MERCHANT_CODE = "MCTEST";
process.env.NEXT_PUBLIC_SITE_URL = "https://tesoria-cpcc.vercel.app";

// ========================================================
// Escenarios
// ========================================================
async function esc1_idNull_primeraCreacion() {
  console.log("\n[1] id null + lookup vacío → crea base (POST=1)");
  resetSumUp();
  sumup.programLookup.push({ kind: "ok", devolver: "vacio" });
  sumup.programCrear.push({ kind: "ok", registraEnMundo: true });

  const sol = makeSolicitud();
  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: null }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);

  assert("tipo === pendiente_nuevo", r.tipo === "pendiente_nuevo", r.tipo);
  assert("crearCheckout llamado 1 vez", sumup.callsCrear === 1, `calls=${sumup.callsCrear}`);
  assert(
    "sumup_checkout_id persistido",
    admin._state.get(sol.id)?.sumup_checkout_id !== null
  );
  assert(
    "lock liberado al final",
    admin._state.get(sol.id)?.checkout_creacion_lock_at === null
  );
}

async function esc2_idNull_lookupEncuentraPENDING_adopta() {
  console.log(
    "\n[2] id null + lookup encuentra PENDING (crash anterior) → adopta sin POST"
  );
  resetSumUp();
  // Simular que SumUp tiene un checkout PENDING con nuestra reference,
  // creado por un POST anterior cuyo cliente no persistio.
  const sol = makeSolicitud();
  const ref = `socio_${sol.id}`;
  const previo: CheckoutResp = {
    id: "chk_huerfano",
    checkout_reference: ref,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PENDING",
    hosted_checkout_url: "https://checkout.sumup.com/huerfano",
  };
  sumup.checkouts.set(previo.id, previo);
  sumup.programLookup.push({ kind: "ok", devolver: "mundo_por_ref" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: null }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);

  assert("tipo === pendiente_reutilizado", r.tipo === "pendiente_reutilizado", r.tipo);
  assert("crearCheckout NO llamado", sumup.callsCrear === 0, `calls=${sumup.callsCrear}`);
  assert(
    "sumup_checkout_id adoptado",
    admin._state.get(sol.id)?.sumup_checkout_id === "chk_huerfano"
  );
}

async function esc3_idNull_lookupEncuentraPAID() {
  console.log("\n[3] id null + lookup encuentra PAID → pagada_live, POST=0");
  resetSumUp();
  const sol = makeSolicitud();
  const ref = `socio_${sol.id}`;
  const previo: CheckoutResp = {
    id: "chk_pagado",
    checkout_reference: ref,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PAID",
    transaction_id: "tx-123",
    transaction_code: "TXCODE",
  };
  sumup.checkouts.set(previo.id, previo);
  sumup.programLookup.push({ kind: "ok", devolver: "mundo_por_ref" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: null }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);

  assert("tipo === pagada_live", r.tipo === "pagada_live", r.tipo);
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
  if (r.tipo === "pagada_live") {
    assert("live.checkout_id correcto", r.live.checkout_id === "chk_pagado");
    assert("live.transaction_id presente", r.live.transaction_id === "tx-123");
  }
  assert(
    "sumup_checkout_id adoptado",
    admin._state.get(sol.id)?.sumup_checkout_id === "chk_pagado"
  );
}

async function esc4_idExistente_PENDING_reutiliza() {
  console.log("\n[4] id != null + GET live PENDING coherente → reutilizar, POST=0");
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_vigente" });
  sumup.checkouts.set("chk_vigente", {
    id: "chk_vigente",
    checkout_reference: `socio_${sol.id}`,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PENDING",
    hosted_checkout_url: "https://checkout.sumup.com/vigente",
  });
  sumup.programGetLive.push({ kind: "ok", status: "PENDING" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_vigente" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === pendiente_reutilizado", r.tipo === "pendiente_reutilizado");
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

async function esc5_idExistente_PAID() {
  console.log("\n[5] id != null + GET live PAID → pagada_live, POST=0");
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_pagado" });
  sumup.checkouts.set("chk_pagado", {
    id: "chk_pagado",
    checkout_reference: `socio_${sol.id}`,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PAID",
    transaction_id: "tx-99",
    transaction_code: "C99",
  });
  sumup.programGetLive.push({ kind: "ok", status: "PAID" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_pagado" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === pagada_live", r.tipo === "pagada_live");
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

async function esc6_idExistente_mismatch() {
  console.log("\n[6] id != null + GET live amount distinto → mismatch, POST=0");
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_malo" });
  sumup.checkouts.set("chk_malo", {
    id: "chk_malo",
    checkout_reference: `socio_${sol.id}`,
    amount: 999, // mismatch
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PENDING",
    hosted_checkout_url: "x",
  });
  sumup.programGetLive.push({ kind: "ok", status: "PENDING", amountOverride: 999 });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_malo" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === mismatch", r.tipo === "mismatch");
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

async function esc7_idExistente_FAILED_versiona() {
  console.log(
    "\n[7] id != null + GET live FAILED + lookup vacío → versionado, POST=1"
  );
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_fallido" });
  sumup.checkouts.set("chk_fallido", {
    id: "chk_fallido",
    checkout_reference: `socio_${sol.id}`,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "FAILED",
  });
  sumup.programGetLive.push({ kind: "ok", status: "FAILED" });
  // Antes de versionar, lookup. Devuelve el fallido en el mundo.
  // Pero seleccionarMejor devuelve ese (unico, terminal). El resolver
  // detecta terminal → crea versionado.
  sumup.programLookup.push({ kind: "ok", devolver: "mundo_por_ref" });
  sumup.programCrear.push({ kind: "ok", registraEnMundo: true });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_fallido" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === pendiente_versionado", r.tipo === "pendiente_versionado", r.tipo);
  assert("crearCheckout llamado 1 vez", sumup.callsCrear === 1);
}

async function esc8_getLive_transient_noCrea() {
  console.log(
    "\n[8] id != null + GET live timeout (AbortError) → verificacion_temporal, POST=0"
  );
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_x" });
  sumup.programGetLive.push({ kind: "throw", error: abortError() });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_x" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert(
    "tipo === verificacion_temporal_no_disponible",
    r.tipo === "verificacion_temporal_no_disponible"
  );
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
  assert("lookup NO llamado", sumup.callsLookup === 0);
}

async function esc9_getLive_500_noCrea() {
  console.log("\n[9] id != null + GET live 500 → verificacion_temporal, POST=0");
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_x" });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(500, "{}", "err") });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_x" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert(
    "tipo === verificacion_temporal_no_disponible",
    r.tipo === "verificacion_temporal_no_disponible"
  );
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

async function esc10_getLive_404x3_lookupVacio_versiona() {
  console.log(
    "\n[10] GET live 404 x3 + lookup vacío → versionado, POST=1"
  );
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_desaparecido" });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programLookup.push({ kind: "ok", devolver: "vacio" });
  sumup.programCrear.push({ kind: "ok", registraEnMundo: true });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_desaparecido" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === pendiente_versionado", r.tipo === "pendiente_versionado", r.tipo);
  assert("crearCheckout llamado 1 vez", sumup.callsCrear === 1);
}

async function esc11_getLive_404x3_lookupPending_reutiliza() {
  console.log(
    "\n[11] GET live 404 x3 + lookup encuentra PENDING → adopta, POST=0"
  );
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_zombie" });
  sumup.checkouts.set("chk_otro", {
    id: "chk_otro",
    checkout_reference: `socio_${sol.id}`,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PENDING",
    hosted_checkout_url: "https://checkout.sumup.com/otro",
  });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programLookup.push({ kind: "ok", devolver: "mundo_por_ref" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_zombie" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === pendiente_reutilizado", r.tipo === "pendiente_reutilizado", r.tipo);
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
  assert(
    "sumup_checkout_id actualizado al recuperado",
    admin._state.get(sol.id)?.sumup_checkout_id === "chk_otro"
  );
}

async function esc12_getLive_404x3_lookupTransient_noCrea() {
  console.log(
    "\n[12] GET live 404 x3 + lookup transient → verificacion_temporal, POST=0"
  );
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_desaparecido" });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(404) });
  sumup.programLookup.push({ kind: "throw", error: sumupErr(503) });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_desaparecido" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert(
    "tipo === verificacion_temporal_no_disponible",
    r.tipo === "verificacion_temporal_no_disponible"
  );
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

async function esc13_post_409_recoveredPending() {
  console.log(
    "\n[13] POST → 409 + lookup PENDING existente → pendiente_recuperado_409, POST intento=1"
  );
  resetSumUp();
  const sol = makeSolicitud(); // id null
  const ref = `socio_${sol.id}`;
  // Primer lookup previo (antes del POST): vacio → el resolver avanza a crear.
  sumup.programLookup.push({ kind: "ok", devolver: "vacio" });
  // POST tira 409.
  sumup.programCrear.push({ kind: "throw", error: sumupErr(409, "{}", "duplicated") });
  // Al recuperar tras 409: lookup encuentra el PENDING que ya existe en SumUp
  // (fue creado por un POST anterior o concurrente que gano la ref).
  sumup.checkouts.set("chk_existente", {
    id: "chk_existente",
    checkout_reference: ref,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PENDING",
    hosted_checkout_url: "https://checkout.sumup.com/existente",
  });
  sumup.programLookup.push({ kind: "ok", devolver: "mundo_por_ref" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: null }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert(
    "tipo === pendiente_recuperado_409",
    r.tipo === "pendiente_recuperado_409",
    r.tipo
  );
  assert("crearCheckout intento 1 vez", sumup.callsCrear === 1);
  assert(
    "sumup_checkout_id adoptado al existente",
    admin._state.get(sol.id)?.sumup_checkout_id === "chk_existente"
  );
}

async function esc14_timeoutPOST_siguienteEjecucion_recupera() {
  console.log(
    "\n[14] POST timeout (SumUp SI lo creo) → NO persistido → siguiente ejec. lookup recupera, POST total = 1"
  );
  resetSumUp();
  const sol = makeSolicitud(); // id null
  // Ejecucion 1: lookup vacio + POST que "llega a SumUp pero timeout en cliente".
  sumup.programLookup.push({ kind: "ok", devolver: "vacio" });
  const errTimeout = abortError();
  (errTimeout as Error & { __simuloCreadoEnMundo?: boolean }).__simuloCreadoEnMundo = true;
  sumup.programCrear.push({ kind: "throw", error: errTimeout });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: null }),
  ]);
  const r1 = await resolverCheckoutIdempotente(admin as never, sol);
  assert(
    "ejec 1: tipo === verificacion_temporal",
    r1.tipo === "verificacion_temporal_no_disponible"
  );
  assert("ejec 1: crearCheckout llamado 1 vez", sumup.callsCrear === 1);
  assert(
    "ejec 1: NO persistido (sigue null)",
    admin._state.get(sol.id)?.sumup_checkout_id === null
  );
  assert(
    "ejec 1: lock liberado",
    admin._state.get(sol.id)?.checkout_creacion_lock_at === null
  );
  assert("ejec 1: SumUp tiene checkout huerfano", sumup.checkouts.size === 1);

  // Ejecucion 2 (refresh): nuevo lookup encuentra el huerfano.
  sumup.programLookup.push({ kind: "ok", devolver: "mundo_por_ref" });
  const freshSol = makeSolicitud(); // relectura (sigue id null porque no persistio)
  const r2 = await resolverCheckoutIdempotente(admin as never, freshSol);
  assert(
    "ejec 2: tipo === pendiente_reutilizado",
    r2.tipo === "pendiente_reutilizado",
    r2.tipo
  );
  assert(
    "ejec 2: crearCheckout NO llamado otra vez (total 1)",
    sumup.callsCrear === 1
  );
  assert(
    "ejec 2: sumup_checkout_id adoptado",
    admin._state.get(sol.id)?.sumup_checkout_id !== null
  );
}

async function esc15_concurrencia_dosRequests_unSoloPOST() {
  console.log(
    "\n[15] Concurrencia: 2 requests paralelas con id null → crearCheckout = 1 vez"
  );
  resetSumUp();
  const sol = makeSolicitud();
  // Ambas requests harán:
  //   lookup (vacio) → claim → crear → persistir → liberar
  // Pero con el mock del claim RPC sincrono, solo UNA obtiene "acquired";
  // la otra ve "busy" y pollea hasta ver sumup_checkout_id ya persistido.
  // Programamos: 2 lookups vacios (uno por request), 1 crearCheckout OK.
  // La segunda request, tras ver busy y luego ver el id persistido, llama
  // obtenerCheckout (GET live) sobre el id ganador para reutilizar.
  sumup.programLookup.push({ kind: "ok", devolver: "vacio" });
  sumup.programLookup.push({ kind: "ok", devolver: "vacio" });
  sumup.programCrear.push({ kind: "ok", registraEnMundo: true });
  sumup.programGetLive.push({ kind: "ok", status: "PENDING" });

  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: null }),
  ]);

  const [rA, rB] = await Promise.all([
    resolverCheckoutIdempotente(admin as never, sol),
    resolverCheckoutIdempotente(admin as never, sol),
  ]);

  assert(
    "crearCheckout llamado EXACTAMENTE 1 vez",
    sumup.callsCrear === 1,
    `calls=${sumup.callsCrear}`
  );
  const tipos = [rA.tipo, rB.tipo].sort();
  assert(
    "resoluciones son {pendiente_nuevo, pendiente_reutilizado}",
    tipos[0] === "pendiente_nuevo" && tipos[1] === "pendiente_reutilizado",
    `tipos=${tipos.join(",")}`
  );
  // Las URLs deben ser iguales (el ganador y el que reutilizó obtienen la misma hosted_url).
  const urlA = (rA as { url?: string }).url ?? "";
  const urlB = (rB as { url?: string }).url ?? "";
  assert("ambas requests reciben la misma hosted_url", urlA === urlB && urlA.length > 0);
  assert(
    "sumup_checkout_id persistido una vez",
    admin._state.get(sol.id)?.sumup_checkout_id !== null
  );
  assert(
    "lock liberado",
    admin._state.get(sol.id)?.checkout_creacion_lock_at === null
  );
}

async function esc16_fatal_noCrea() {
  console.log("\n[16] GET live 403 → error_fatal, POST=0");
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_x" });
  sumup.programGetLive.push({ kind: "throw", error: sumupErr(403, "{}", "forbidden") });
  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_x" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert("tipo === error_fatal", r.tipo === "error_fatal");
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

async function esc17_networkError_noCrea() {
  console.log(
    "\n[17] GET live TypeError (fetch failed red) → verificacion_temporal, POST=0"
  );
  resetSumUp();
  const sol = makeSolicitud({ sumup_checkout_id: "chk_x" });
  sumup.programGetLive.push({ kind: "throw", error: networkError() });
  const admin = mockAdmin([
    makeFila({ ...sol, sumup_checkout_id: "chk_x" }),
  ]);
  const r = await resolverCheckoutIdempotente(admin as never, sol);
  assert(
    "tipo === verificacion_temporal_no_disponible",
    r.tipo === "verificacion_temporal_no_disponible"
  );
  assert("crearCheckout NO llamado", sumup.callsCrear === 0);
}

// Prueba directa de las RPC de lock (sin pasar por resolver). Simula
// expiracion del lock de A, adquisicion por B, y verifica que el
// liberar() tardio de A no afecta el lock de B.
async function esc18_staleReleaseConToken() {
  console.log(
    "\n[18] stale-release: A expira → B toma → A libera (no-op) → B libera (ok)"
  );
  const sol = makeSolicitud();
  const admin = mockAdmin([makeFila(sol)]);
  const tokenA = "token-aaaa-aaaa";
  const tokenB = "token-bbbb-bbbb";

  // A adquiere lock con tokenA
  const r1 = (await admin.rpc("claim_checkout_creacion_lock", {
    p_solicitud_id: sol.id,
    p_expected_checkout_id: null,
    p_lock_token: tokenA,
  })) as { data: string; error: null };
  assert("A: claim acquired", r1.data === "acquired");
  assert(
    "A: lock_token guardado = tokenA",
    admin._state.get(sol.id)?.checkout_creacion_lock_token === tokenA
  );

  // Simular que paso > 30s: setear lock_at al pasado.
  const stale = new Date(Date.now() - 60_000).toISOString();
  admin._state.get(sol.id)!.checkout_creacion_lock_at = stale;

  // B adquiere con tokenB (TTL expirado permite reemplazar).
  const r2 = (await admin.rpc("claim_checkout_creacion_lock", {
    p_solicitud_id: sol.id,
    p_expected_checkout_id: null,
    p_lock_token: tokenB,
  })) as { data: string; error: null };
  assert("B: claim acquired tras expiracion A", r2.data === "acquired");
  assert(
    "B: lock_token guardado = tokenB (sobrescrito)",
    admin._state.get(sol.id)?.checkout_creacion_lock_token === tokenB
  );

  // A ejecuta su finally tardio con tokenA → debe ser NO-OP.
  const r3 = (await admin.rpc("liberar_checkout_creacion_lock", {
    p_solicitud_id: sol.id,
    p_lock_token: tokenA,
  })) as { data: boolean; error: null };
  assert("A: liberar devuelve false (token no coincide)", r3.data === false);
  assert(
    "lock de B sigue intacto (lock_at != null)",
    admin._state.get(sol.id)?.checkout_creacion_lock_at !== null
  );
  assert(
    "lock de B sigue siendo tokenB",
    admin._state.get(sol.id)?.checkout_creacion_lock_token === tokenB
  );

  // B libera con su tokenB → OK.
  const r4 = (await admin.rpc("liberar_checkout_creacion_lock", {
    p_solicitud_id: sol.id,
    p_lock_token: tokenB,
  })) as { data: boolean; error: null };
  assert("B: liberar devuelve true", r4.data === true);
  assert(
    "lock_at queda NULL",
    admin._state.get(sol.id)?.checkout_creacion_lock_at === null
  );
  assert(
    "lock_token queda NULL",
    admin._state.get(sol.id)?.checkout_creacion_lock_token === null
  );
}

async function main() {
  console.log("=== Tests Fase idempotencia /incorporacion/pago ===");
  await esc1_idNull_primeraCreacion();
  await esc2_idNull_lookupEncuentraPENDING_adopta();
  await esc3_idNull_lookupEncuentraPAID();
  await esc4_idExistente_PENDING_reutiliza();
  await esc5_idExistente_PAID();
  await esc6_idExistente_mismatch();
  await esc7_idExistente_FAILED_versiona();
  await esc8_getLive_transient_noCrea();
  await esc9_getLive_500_noCrea();
  await esc10_getLive_404x3_lookupVacio_versiona();
  await esc11_getLive_404x3_lookupPending_reutiliza();
  await esc12_getLive_404x3_lookupTransient_noCrea();
  await esc13_post_409_recoveredPending();
  await esc14_timeoutPOST_siguienteEjecucion_recupera();
  await esc15_concurrencia_dosRequests_unSoloPOST();
  await esc16_fatal_noCrea();
  await esc17_networkError_noCrea();
  await esc18_staleReleaseConToken();

  const fallos = results.filter((r) => !r.ok);
  console.log("\n=== Resumen ===");
  console.log(
    `Total: ${results.length} — OK: ${results.length - fallos.length} — Fallos: ${fallos.length}`
  );
  if (fallos.length > 0) {
    console.log("\nFallos:");
    for (const f of fallos) console.log(` ✗ ${f.nombre} — ${f.detalle}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
