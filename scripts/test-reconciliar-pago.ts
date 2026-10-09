// Tests offline de reconciliarPagoSocio.
// Ejecutar: npx tsx scripts/test-reconciliar-pago.ts
//
// NO toca Supabase ni SumUp reales. Mock de la RPC core en memoria con
// semantica atomica equivalente a la 035, mock del claim de email
// (migracion 034), mock de fetch SumUp (interceptor global), mock de
// nodemailer (via lib/email/mailer).
//
// Escenarios cubiertos (requeridos):
// 1  PAID nuevo completo
// 2  Doble ejecucion secuencial
// 3  Concurrencia webhook/admin
// 4  Movimiento ya existente (reutiliza)
// 5  Pagada pero movimiento faltante (REPARA)
// 6  Movimiento existente pero estado pendiente (REPARA)
// 7  QR existente (no regenera)
// 8  socio_periodo mayor no retrocede
// 9  Mismatch amount
// 10 Mismatch merchant
// 11 PENDING (no_paid, no tocar)
// 12 Correo falla y puede reintentarse
// 13 Correo concurrente no duplica

// =============================================================
// Env mock (debe setearse ANTES de importar los módulos de app).
// =============================================================
process.env.SUMUP_API_KEY = "test_api_key_mock";
process.env.SUMUP_MERCHANT_CODE = "MCTEST";
process.env.NEXT_PUBLIC_SITE_URL = "https://tesoria-cpcc.vercel.app";
process.env.GMAIL_USER = "test@example.cl";
process.env.GMAIL_APP_PASSWORD = "test";

// =============================================================
// Mock de nodemailer: parche createTransport (singleton CJS).
// Debe ejecutarse ANTES de que lib/email/mailer.ts llame transporter().
// =============================================================
type MailAction = { kind: "ok" } | { kind: "throw"; error: Error };
const mailerState: {
  calls: number;
  programa: MailAction[];
  destinatarios: string[];
} = { calls: 0, programa: [], destinatarios: [] };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodemailerMod = require("nodemailer");
nodemailerMod.createTransport = () => ({
  sendMail: async (opts: { to: string }) => {
    mailerState.calls++;
    mailerState.destinatarios.push(opts.to);
    const action = mailerState.programa.shift() ?? { kind: "ok" };
    if (action.kind === "throw") throw action.error;
    return { messageId: "mock" };
  },
  verify: async () => true,
});

// Tipos pueden importarse estaticamente (son borrados en runtime).
import type { CheckoutResp } from "../lib/sumup/client";
import type { SocioSolicitud } from "../lib/types";

// Imports de VALOR via require DESPUES del patch de nodemailer (CJS,
// mismo singleton que lib/email/mailer.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reconciliarPagoSocio } = require("../lib/socios/reconciliar-pago") as {
  reconciliarPagoSocio: typeof import("../lib/socios/reconciliar-pago").reconciliarPagoSocio;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SumUpError } = require("../lib/sumup/client") as {
  SumUpError: typeof import("../lib/sumup/client").SumUpError;
};

// =============================================================
// Mock del cliente Supabase admin (RPC + from)
// =============================================================
type FilaSolicitud = SocioSolicitud & {
  checkout_creacion_lock_at: string | null;
  checkout_creacion_lock_token: string | null;
  email_envio_lock_at: string | null;
  email_envio_lock_token: string | null;
};
type FilaApoderado = {
  id: string;
  socio: boolean;
  socio_periodo: number | null;
  qr_token: string | null;
};
type FilaMovimiento = {
  id: string;
  fecha: string;
  tipo: string;
  monto: number;
  descripcion: string;
  cuenta_id: string | null;
  categoria_id: string | null;
  socio_solicitud_id: string | null;
};
type FilaConfig = {
  id: number;
  cuenta_sumup_id: string | null;
  categoria_cuota_id: string | null;
};

function mockAdmin(initial: {
  solicitudes?: FilaSolicitud[];
  apoderados?: FilaApoderado[];
  movimientos?: FilaMovimiento[];
  socio_config?: FilaConfig;
}) {
  const sols = new Map<string, FilaSolicitud>(
    (initial.solicitudes ?? []).map((f) => [f.id, { ...f }])
  );
  const apos = new Map<string, FilaApoderado>(
    (initial.apoderados ?? []).map((f) => [f.id, { ...f }])
  );
  const movs = new Map<string, FilaMovimiento>(
    (initial.movimientos ?? []).map((f) => [f.id, { ...f }])
  );
  const cfg: FilaConfig = initial.socio_config ?? {
    id: 1,
    cuenta_sumup_id: "cnt-sumup",
    categoria_cuota_id: "cat-cuota",
  };

  let movCreateCount = 0;

  function builder(tableName: string) {
    const filters: Array<(f: Record<string, unknown>) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: Record<string, unknown> | null = null;
    let insertRow: Record<string, unknown> | null = null;

    function getMap(): Map<string | number, Record<string, unknown>> {
      if (tableName === "socio_solicitudes")
        return sols as unknown as Map<string | number, Record<string, unknown>>;
      if (tableName === "apoderados")
        return apos as unknown as Map<string | number, Record<string, unknown>>;
      if (tableName === "movimientos")
        return movs as unknown as Map<string | number, Record<string, unknown>>;
      if (tableName === "socio_config")
        return new Map<string | number, Record<string, unknown>>([
          [1, cfg as unknown as Record<string, unknown>],
        ]);
      // contactos: no modelado en estos tests → devuelve mapa vacio
      // (el saludo cae a "Hola," neutro, suficiente para los asserts).
      if (tableName === "contactos")
        return new Map<string | number, Record<string, unknown>>();
      throw new Error("tabla no soportada: " + tableName);
    }

    function execSync(): { data: unknown; error: null } {
      const map = getMap();
      const all = Array.from(map.values());
      const matches = all.filter((f) =>
        filters.every((p) => p(f))
      );
      if (mode === "update" && patch) {
        for (const m of matches) {
          Object.assign(m, patch);
        }
        return { data: matches.map((m) => ({ ...m })), error: null };
      }
      if (mode === "insert" && insertRow) {
        if (tableName === "movimientos") {
          movCreateCount++;
          const row = insertRow;
          const id = (row.id as string | undefined) ?? `mov_${movCreateCount}`;
          if (
            row.socio_solicitud_id &&
            Array.from(movs.values()).some(
              (m) => m.socio_solicitud_id === row.socio_solicitud_id
            )
          ) {
            throw { code: "23505", message: "unique_violation" };
          }
          const nuevo: FilaMovimiento = {
            id,
            fecha: row.fecha as string,
            tipo: row.tipo as string,
            monto: row.monto as number,
            descripcion: row.descripcion as string,
            cuenta_id: (row.cuenta_id as string | null) ?? null,
            categoria_id: (row.categoria_id as string | null) ?? null,
            socio_solicitud_id: (row.socio_solicitud_id as string | null) ?? null,
          };
          movs.set(id, nuevo);
          return { data: [nuevo], error: null };
        }
      }
      return { data: matches.map((m) => ({ ...m })), error: null };
    }

    const b = {
      select(_cols?: string) {
        return b;
      },
      update(p: Record<string, unknown>) {
        mode = "update";
        patch = p;
        return b;
      },
      insert(row: Record<string, unknown>) {
        mode = "insert";
        insertRow = row;
        return b;
      },
      eq(col: string, val: unknown) {
        filters.push((f) => f[col] === val);
        return b;
      },
      is(col: string, val: unknown) {
        filters.push((f) => f[col] === val);
        return b;
      },
      in(col: string, vals: unknown[]) {
        filters.push((f) => vals.includes(f[col]));
        return b;
      },
      ilike(col: string, val: string) {
        const needle = val.toLowerCase();
        filters.push((f) => {
          const v = f[col];
          return typeof v === "string" && v.toLowerCase() === needle;
        });
        return b;
      },
      limit(_n: number) {
        return b;
      },
      async maybeSingle() {
        const r = execSync();
        const arr = (r.data as unknown[]) ?? [];
        return { data: arr.length > 0 ? arr[0] : null, error: null };
      },
      async single() {
        const r = execSync();
        const arr = (r.data as unknown[]) ?? [];
        return { data: arr.length > 0 ? arr[0] : null, error: null };
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve(execSync()));
      },
    };
    return b;
  }

  async function rpc(name: string, params: Record<string, unknown>) {
    if (name === "reconciliar_pago_socio_core") {
      return rpcCore(params);
    }
    if (name === "claim_email_envio_lock") {
      return rpcClaimEmail(params);
    }
    if (name === "liberar_email_envio_lock") {
      return rpcLiberarEmail(params);
    }
    throw new Error("rpc no soportada: " + name);
  }

  function rpcCore(params: Record<string, unknown>): { data: unknown; error: null } {
    const sol = sols.get(params.p_solicitud_id as string);
    if (!sol) {
      return {
        data: [
          {
            resultado: "solicitud_no_encontrada",
            detalle: null,
            movimiento_id: null,
            estado_final: null,
            movimiento_creado: false,
            qr_generado: false,
            socio_actualizado: false,
            socio_periodo_actualizado: false,
          },
        ],
        error: null,
      };
    }
    const liveCheckoutId = params.p_live_checkout_id as string;
    const liveAmount = params.p_live_amount as number;
    const liveCurrency = params.p_live_currency as string;
    const liveMerchant = (params.p_live_merchant_code as string) ?? null;
    const liveRef = params.p_live_checkout_reference as string;
    const liveTxId = (params.p_live_transaction_id as string) ?? null;
    const liveTxCode = (params.p_live_transaction_code as string) ?? null;
    const expectedMerchant = (params.p_expected_merchant_code as string) ?? null;

    const mismatch = (det: string) => ({
      data: [
        {
          resultado: "mismatch",
          detalle: det,
          movimiento_id: null,
          estado_final: sol.estado,
          movimiento_creado: false,
          qr_generado: false,
          socio_actualizado: false,
          socio_periodo_actualizado: false,
        },
      ],
      error: null,
    });

    if (sol.sumup_checkout_id !== liveCheckoutId)
      return mismatch(
        `sumup_checkout_id en DB (${sol.sumup_checkout_id}) != live (${liveCheckoutId})`
      );
    if (!liveRef.startsWith(`socio_${sol.id}`))
      return mismatch(`reference ${liveRef} no corresponde a socio_${sol.id}`);
    if (liveAmount !== sol.monto_cuota)
      return mismatch(`amount ${liveAmount} != ${sol.monto_cuota}`);
    if (liveCurrency !== "CLP")
      return mismatch(`currency ${liveCurrency} != CLP`);
    if (expectedMerchant && liveMerchant && expectedMerchant !== liveMerchant)
      return mismatch(`merchant ${liveMerchant} != ${expectedMerchant}`);

    const estadoInicial = sol.estado;
    let movId: string | null = null;
    let movCreado = false;

    // Movimiento idempotente.
    const movExistente = Array.from(movs.values()).find(
      (m) => m.socio_solicitud_id === sol.id
    );
    if (movExistente) movId = movExistente.id;
    else if (sol.movimiento_id) {
      const m = movs.get(sol.movimiento_id);
      if (m && m.socio_solicitud_id == null) {
        m.socio_solicitud_id = sol.id;
      }
      movId = sol.movimiento_id;
    }

    if (!movId && cfg.cuenta_sumup_id) {
      movCreateCount++;
      const id = `mov_${movCreateCount}`;
      const nuevo: FilaMovimiento = {
        id,
        fecha: new Date().toISOString().slice(0, 10),
        tipo: "ingreso",
        monto: sol.monto_cuota,
        descripcion: `Cuota socio CdP ${sol.periodo_anio} — ${sol.apoderado_nombre} (SumUp)`,
        cuenta_id: cfg.cuenta_sumup_id,
        categoria_id: cfg.categoria_cuota_id,
        socio_solicitud_id: sol.id,
      };
      movs.set(id, nuevo);
      movId = id;
      movCreado = true;
    }

    // Update solicitud idempotente (no retrocede).
    if (!(sol.estado === "pagada" || sol.estado === "enviada")) {
      sol.estado = "pagada";
    }
    sol.pagada_en = sol.pagada_en ?? new Date().toISOString();
    sol.sumup_transaction_id = sol.sumup_transaction_id ?? liveTxId;
    sol.sumup_transaction_code = sol.sumup_transaction_code ?? liveTxCode;
    sol.movimiento_id = sol.movimiento_id ?? movId;

    // Apoderado.
    let qrGen = false;
    let socioAct = false;
    let periodoAct = false;
    if (sol.apoderado_id) {
      const ap = apos.get(sol.apoderado_id);
      if (ap) {
        const nuevoPeriodo = Math.max(ap.socio_periodo ?? 0, sol.periodo_anio);
        if (ap.socio !== true) {
          ap.socio = true;
          socioAct = true;
        }
        if (ap.socio_periodo !== nuevoPeriodo) {
          ap.socio_periodo = nuevoPeriodo;
          periodoAct = true;
        }
        if (ap.qr_token == null) {
          ap.qr_token = `qr_${Math.random().toString(36).slice(2, 10)}`;
          qrGen = true;
        }
      }
    }

    const resultado =
      estadoInicial === "pagada" || estadoInicial === "enviada"
        ? !movCreado && !qrGen && !socioAct && !periodoAct
          ? "ya_reconciliada"
          : "reconciliada"
        : "reconciliada";

    return {
      data: [
        {
          resultado,
          detalle: null,
          movimiento_id: movId,
          estado_final: sol.estado,
          movimiento_creado: movCreado,
          qr_generado: qrGen,
          socio_actualizado: socioAct,
          socio_periodo_actualizado: periodoAct,
        },
      ],
      error: null,
    };
  }

  function rpcClaimEmail(params: Record<string, unknown>): { data: unknown; error: null } {
    const sol = sols.get(params.p_solicitud_id as string);
    const token = params.p_lock_token as string;
    if (!sol) return { data: "solicitud_no_encontrada", error: null };
    if (sol.email_enviado_en) return { data: "ya_enviado", error: null };
    if (
      sol.email_envio_lock_at &&
      new Date(sol.email_envio_lock_at).getTime() > Date.now() - 30_000
    ) {
      return { data: "busy", error: null };
    }
    sol.email_envio_lock_at = new Date().toISOString();
    sol.email_envio_lock_token = token;
    return { data: "acquired", error: null };
  }

  function rpcLiberarEmail(params: Record<string, unknown>): { data: unknown; error: null } {
    const sol = sols.get(params.p_solicitud_id as string);
    const token = params.p_lock_token as string;
    if (!sol) return { data: false, error: null };
    if (sol.email_envio_lock_token !== token) return { data: false, error: null };
    sol.email_envio_lock_at = null;
    sol.email_envio_lock_token = null;
    return { data: true, error: null };
  }

  return {
    _state: { sols, apos, movs, cfg, get movCreateCount() { return movCreateCount; } },
    from: builder,
    rpc,
  };
}

// =============================================================
// Mock fetch SumUp
// =============================================================
const sumupMock: {
  checkouts: Map<string, CheckoutResp>;
  programGet: Array<GetAct>;
  callsGet: number;
} = { checkouts: new Map(), programGet: [], callsGet: 0 };
type GetAct =
  | { kind: "ok"; status: CheckoutResp["status"] }
  | { kind: "throw"; err: Error };

const SUMUP_HOST = "https://api.sumup.com/v0.1";
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  if (!url.startsWith(SUMUP_HOST)) return originalFetch(input as RequestInfo, init);
  const path = url.slice(SUMUP_HOST.length);
  const m = path.match(/^\/checkouts\/([^?]+)$/);
  if (m) {
    sumupMock.callsGet++;
    const id = m[1];
    const act = sumupMock.programGet.shift();
    if (!act) throw new Error("mock get agotado " + id);
    if (act.kind === "throw") {
      const err = act.err;
      if ((err as Error).name === "SumUpError") {
        const se = err as InstanceType<typeof SumUpError>;
        return new Response(se.bodyText || "{}", { status: se.status });
      }
      throw err;
    }
    const existing = sumupMock.checkouts.get(id);
    const resp = existing
      ? { ...existing, status: act.status }
      : { id, status: act.status, amount: 0, currency: "CLP", checkout_reference: "" };
    return new Response(JSON.stringify(resp), { status: 200 });
  }
  return new Response("mock no route", { status: 500 });
}) as typeof fetch;

// =============================================================
// Helpers de test
// =============================================================
function makeSolicitud(overrides: Partial<FilaSolicitud> = {}): FilaSolicitud {
  const base: FilaSolicitud = {
    id: "11111111-1111-1111-1111-111111111111",
    qr_token: "22222222-2222-2222-2222-222222222222",
    periodo_anio: 2027,
    apoderado_id: "aaaa1111-1111-1111-1111-111111111111",
    apoderado_nombre: "Familia Test",
    apoderado_email: "familia.test@example.cl",
    apoderado_rut: null,
    apoderado_telefono: null,
    alumno_nombre: "Alumno Test",
    curso: "1° Básico A",
    monto_cuota: 18500,
    sumup_checkout_id: "chk-abc",
    sumup_transaction_id: null,
    sumup_transaction_code: null,
    movimiento_id: null,
    pagada_en: null,
    email_enviado_en: null,
    email_reenvios: 0,
    estado: "pendiente_pago",
    notas_internas: null,
    procesada_por: null,
    tipo_correo: "bienvenida",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    checkout_creacion_lock_at: null,
    checkout_creacion_lock_token: null,
    email_envio_lock_at: null,
    email_envio_lock_token: null,
  };
  return { ...base, ...overrides };
}

function makeApoderado(overrides: Partial<FilaApoderado> = {}): FilaApoderado {
  return {
    id: "aaaa1111-1111-1111-1111-111111111111",
    socio: false,
    socio_periodo: null,
    qr_token: null,
    ...overrides,
  };
}

function makeLive(sol: FilaSolicitud, overrides: Partial<CheckoutResp> = {}): CheckoutResp {
  return {
    id: sol.sumup_checkout_id ?? "chk-abc",
    checkout_reference: `socio_${sol.id}`,
    amount: sol.monto_cuota,
    currency: "CLP",
    merchant_code: "MCTEST",
    status: "PAID",
    transaction_id: "tx-123",
    transaction_code: "TC123",
    ...overrides,
  };
}

function resetAll() {
  sumupMock.checkouts.clear();
  sumupMock.programGet = [];
  sumupMock.callsGet = 0;
  mailerState.calls = 0;
  mailerState.programa = [];
  mailerState.destinatarios = [];
}

type TR = { nombre: string; ok: boolean; detalle?: string };
const results: TR[] = [];
function assert(n: string, cond: boolean, det = "") {
  results.push({ nombre: n, ok: cond, detalle: det });
  console.log(`  ${cond ? "✓" : "✗"} ${n}${det ? " — " + det : ""}`);
}

// =============================================================
// Escenarios
// =============================================================
async function esc1_paidNuevoCompleto() {
  console.log("\n[1] PAID nuevo completo");
  resetAll();
  const sol = makeSolicitud();
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });
  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("tipo = reconciliada", r.resultado === "reconciliada");
  if (r.resultado === "reconciliada") {
    assert("movimiento_creado", r.core.movimiento_creado);
    assert("qr_generado", r.core.qr_generado);
    assert("socio_actualizado", r.core.socio_actualizado);
    assert("estado_final = enviada o pagada tras correo", r.core.estado_final === "enviada" || r.core.estado_final === "pagada");
    assert("correo = enviado", r.correo === "enviado");
  }
  assert("mailer.calls = 1", mailerState.calls === 1);
}

async function esc2_dobleEjecucion() {
  console.log("\n[2] Doble ejecución secuencial");
  resetAll();
  const sol = makeSolicitud();
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r1 = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("1a: reconciliada", r1.resultado === "reconciliada");
  const movCount1 = admin._state.movCreateCount;

  const r2 = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("2a: ya_reconciliada", r2.resultado === "ya_reconciliada");
  assert("mailer.calls = 1 (no duplica)", mailerState.calls === 1);
  assert(
    "movCreateCount no incrementa",
    admin._state.movCreateCount === movCount1
  );
}

async function esc3_concurrencia() {
  console.log("\n[3] Concurrencia webhook/admin");
  resetAll();
  const sol = makeSolicitud();
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  const live = makeLive(sol);
  sumupMock.checkouts.set("chk-abc", live);
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const [rA, rB] = await Promise.all([
    reconciliarPagoSocio(admin as never, { modo: "por_live", solicitudId: sol.id, live }),
    reconciliarPagoSocio(admin as never, { modo: "por_live", solicitudId: sol.id, live }),
  ]);

  const tipos = [rA.resultado, rB.resultado].sort();
  assert(
    "una reconciliada y una ya_reconciliada o ambas reconciliada (RPC mock no serializa; verifica no-duplicacion)",
    (tipos[0] === "reconciliada" && tipos[1] === "ya_reconciliada") ||
      (tipos[0] === "reconciliada" && tipos[1] === "reconciliada")
  );
  assert("mailer.calls <= 1", mailerState.calls <= 1);
  assert("movCreateCount = 1 (UNIQUE constraint)", admin._state.movCreateCount === 1);
}

async function esc4_movimientoExistente() {
  console.log("\n[4] Movimiento ya existente (reutiliza)");
  resetAll();
  const sol = makeSolicitud({ movimiento_id: "mov_prev" });
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const movPrev: FilaMovimiento = {
    id: "mov_prev",
    fecha: "2026-01-01",
    tipo: "ingreso",
    monto: 18500,
    descripcion: "preexistente",
    cuenta_id: "cnt-x",
    categoria_id: "cat-x",
    socio_solicitud_id: sol.id,
  };
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap], movimientos: [movPrev] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("reconciliada", r.resultado === "reconciliada");
  if (r.resultado === "reconciliada") {
    assert("movimiento_creado = false", !r.core.movimiento_creado);
    assert("movimiento_id reutiliza mov_prev", r.core.movimiento_id === "mov_prev");
  }
}

async function esc5_pagadaSinMovimiento() {
  console.log("\n[5] Pagada pero movimiento faltante (REPARA)");
  resetAll();
  const sol = makeSolicitud({
    estado: "pagada",
    pagada_en: "2026-10-10T00:00:00Z",
    sumup_transaction_id: "tx-old",
    movimiento_id: null,
  });
  const ap = makeApoderado({ id: sol.apoderado_id!, socio: true, socio_periodo: 2027, qr_token: "qr-exist" });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("reconciliada (reparo movimiento)", r.resultado === "reconciliada");
  if (r.resultado === "reconciliada") {
    assert("movimiento_creado = true", r.core.movimiento_creado);
    assert("movimiento_id presente", r.core.movimiento_id != null);
    assert("solicitud.movimiento_id persiste", admin._state.sols.get(sol.id)!.movimiento_id != null);
  }
}

async function esc6_movimientoSinEstadoPagada() {
  console.log("\n[6] Movimiento existente pero estado pendiente (REPARA)");
  resetAll();
  const sol = makeSolicitud({ estado: "pendiente_pago" });
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const movPrev: FilaMovimiento = {
    id: "mov_sin_link_estado",
    fecha: "2026-10-10",
    tipo: "ingreso",
    monto: 18500,
    descripcion: "preexistente",
    cuenta_id: "cnt-x",
    categoria_id: "cat-x",
    socio_solicitud_id: sol.id,
  };
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap], movimientos: [movPrev] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("reconciliada", r.resultado === "reconciliada");
  const estadoFinal = admin._state.sols.get(sol.id)!.estado;
  assert("estado final = pagada o enviada", estadoFinal === "pagada" || estadoFinal === "enviada");
  if (r.resultado === "reconciliada") {
    assert("movimiento_creado = false (reutiliza)", !r.core.movimiento_creado);
  }
}

async function esc7_qrExistente() {
  console.log("\n[7] QR existente (no regenera)");
  resetAll();
  const sol = makeSolicitud();
  const ap = makeApoderado({ id: sol.apoderado_id!, qr_token: "qr-ya-existe" });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("reconciliada", r.resultado === "reconciliada");
  if (r.resultado === "reconciliada") {
    assert("qr_generado = false", !r.core.qr_generado);
  }
  assert(
    "qr_token NO cambio",
    admin._state.apos.get(sol.apoderado_id!)!.qr_token === "qr-ya-existe"
  );
}

async function esc8_socioPeriodoMayorNoRetrocede() {
  console.log("\n[8] socio_periodo mayor no retrocede");
  resetAll();
  const sol = makeSolicitud({ periodo_anio: 2027 });
  const ap = makeApoderado({ id: sol.apoderado_id!, socio: true, socio_periodo: 2028, qr_token: "qr-x" });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("reconciliada", r.resultado === "reconciliada");
  assert(
    "socio_periodo sigue 2028 (no retrocedio)",
    admin._state.apos.get(sol.apoderado_id!)!.socio_periodo === 2028
  );
  if (r.resultado === "reconciliada") {
    assert("socio_periodo_actualizado = false", !r.core.socio_periodo_actualizado);
  }
}

async function esc9_mismatchAmount() {
  console.log("\n[9] Mismatch amount");
  resetAll();
  const sol = makeSolicitud({ monto_cuota: 20000 });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [makeApoderado({ id: sol.apoderado_id! })] });
  const live = makeLive(sol, { amount: 18500 });
  sumupMock.checkouts.set("chk-abc", live);
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("mismatch", r.resultado === "mismatch");
  assert(
    "estado NO cambio",
    admin._state.sols.get(sol.id)!.estado === "pendiente_pago"
  );
  assert("mailer.calls = 0", mailerState.calls === 0);
}

async function esc10_mismatchMerchant() {
  console.log("\n[10] Mismatch merchant");
  resetAll();
  const sol = makeSolicitud();
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [makeApoderado({ id: sol.apoderado_id! })] });
  const live = makeLive(sol, { merchant_code: "OTRO" });
  sumupMock.checkouts.set("chk-abc", live);
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("mismatch", r.resultado === "mismatch");
  assert("mailer.calls = 0", mailerState.calls === 0);
}

async function esc11_pending() {
  console.log("\n[11] PENDING (no_paid, no tocar)");
  resetAll();
  const sol = makeSolicitud();
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [makeApoderado({ id: sol.apoderado_id! })] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol, { status: "PENDING" }));
  sumupMock.programGet.push({ kind: "ok", status: "PENDING" });

  const r = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("no_paid", r.resultado === "no_paid");
  assert(
    "estado NO cambio",
    admin._state.sols.get(sol.id)!.estado === "pendiente_pago"
  );
  assert("mailer.calls = 0", mailerState.calls === 0);
}

async function esc12_correoFallaRetry() {
  console.log("\n[12] Correo falla y puede reintentarse");
  resetAll();
  const sol = makeSolicitud();
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  sumupMock.checkouts.set("chk-abc", makeLive(sol));
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });
  mailerState.programa.push({ kind: "throw", error: new Error("SMTP down") });

  const r1 = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert("1a: reconciliada en DB", r1.resultado === "reconciliada");
  if (r1.resultado === "reconciliada") {
    assert("correo = fallo", r1.correo === "fallo");
  }
  // DB sigue pagada; email_enviado_en = null → retry debe mandar.
  const fresh = admin._state.sols.get(sol.id)!;
  assert("estado = pagada", fresh.estado === "pagada");
  assert("email_enviado_en = null", fresh.email_enviado_en == null);
  assert("email_envio_lock_token = null (liberado)", fresh.email_envio_lock_token == null);

  // Retry.
  mailerState.programa.push({ kind: "ok" });
  const r2 = await reconciliarPagoSocio(admin as never, {
    modo: "por_solicitud_id",
    solicitudId: sol.id,
  });
  assert(
    "2a: ya_reconciliada en DB + correo enviado",
    r2.resultado === "ya_reconciliada"
  );
  if (r2.resultado === "ya_reconciliada") {
    assert("correo = enviado en retry", r2.correo === "enviado");
  }
  assert("mailer.calls total = 2 (fallo + retry)", mailerState.calls === 2);
}

async function esc13_correoConcurrenteNoDuplica() {
  console.log("\n[13] Correo concurrente no duplica");
  resetAll();
  const sol = makeSolicitud();
  const ap = makeApoderado({ id: sol.apoderado_id! });
  const admin = mockAdmin({ solicitudes: [sol], apoderados: [ap] });
  const live = makeLive(sol);
  sumupMock.checkouts.set("chk-abc", live);
  sumupMock.programGet.push({ kind: "ok", status: "PAID" });
  mailerState.programa.push({ kind: "ok" });

  // Dos reconciliaciones concurrentes con live ya en mano.
  const [rA, rB] = await Promise.all([
    reconciliarPagoSocio(admin as never, { modo: "por_live", solicitudId: sol.id, live }),
    reconciliarPagoSocio(admin as never, { modo: "por_live", solicitudId: sol.id, live }),
  ]);
  assert("mailer.calls <= 1 (claim atomico)", mailerState.calls <= 1);
  assert(
    "al menos una devolvio enviado o ya_enviado o busy",
    [rA, rB].some((r) =>
      (r.resultado === "reconciliada" || r.resultado === "ya_reconciliada") &&
      (r.correo === "enviado" || r.correo === "ya_enviado" || r.correo === "busy_otro_proceso")
    )
  );
}

async function main() {
  console.log("=== Tests reconciliarPagoSocio ===");
  await esc1_paidNuevoCompleto();
  await esc2_dobleEjecucion();
  await esc3_concurrencia();
  await esc4_movimientoExistente();
  await esc5_pagadaSinMovimiento();
  await esc6_movimientoSinEstadoPagada();
  await esc7_qrExistente();
  await esc8_socioPeriodoMayorNoRetrocede();
  await esc9_mismatchAmount();
  await esc10_mismatchMerchant();
  await esc11_pending();
  await esc12_correoFallaRetry();
  await esc13_correoConcurrenteNoDuplica();

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
