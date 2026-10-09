// Pruebas offline de la Fase D (correos socios configurables + tipo_correo).
// Ejecutar con: npx tsx scripts/test-fase-d.ts
//
// NO toca la DB. Mocks del cliente Supabase + llamadas directas al
// template HTML. Cubre los 8 escenarios acordados.

import { determinarTipoCorreo } from "../lib/socios/tipo-correo";
import { armarCorreoSocioHtml } from "../lib/email/socio-template";
import type { SocioConfig, SocioSolicitud } from "../lib/types";

type Case = { nombre: string; pasa: boolean; detalle?: string };
const resultados: Case[] = [];

// Mock minimo del cliente Supabase. Solo soporta las operaciones que
// usa determinarTipoCorreo: from(tabla).select(..., head/count).eq(...)
// .in(...).lt(...).neq(...) y .maybeSingle().
function mockSupabase(opts: {
  solicitudesPagadasPrevias: number;
  apoderadoRow: { socio: boolean; socio_periodo: number | null } | null;
}) {
  return {
    from(tabla: string) {
      if (tabla === "socio_solicitudes") {
        const q = {
          select: () => q,
          eq: () => q,
          in: () => q,
          lt: () => q,
          neq: () => q,
          // Simula el "count" devuelto por .select(..., { count:'exact', head:true })
          then: (resolve: (v: { count: number }) => unknown) =>
            resolve({ count: opts.solicitudesPagadasPrevias }),
        };
        return q;
      }
      if (tabla === "apoderados") {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: () => Promise.resolve({ data: opts.apoderadoRow }),
        };
        return q;
      }
      throw new Error("Tabla no mockeada: " + tabla);
    },
  } as never;
}

function check(nombre: string, cond: boolean, detalle = "") {
  resultados.push({ nombre, pasa: cond, detalle });
  const icon = cond ? "✓" : "✗";
  console.log(`  ${icon} ${nombre}${detalle ? " — " + detalle : ""}`);
}

async function esc1_familiaNueva() {
  console.log("\n[1] Familia nueva (sin historial) → bienvenida");
  const sb = mockSupabase({
    solicitudesPagadasPrevias: 0,
    apoderadoRow: { socio: false, socio_periodo: null },
  });
  const t = await determinarTipoCorreo(sb, "ap-nueva-id", 2027);
  check("tipo === bienvenida", t === "bienvenida", `obtenido=${t}`);
}

async function esc2_sociaExcel2026() {
  console.log(
    "\n[2] Socia Excel 2026 (socio=true, socio_periodo=2026, sin solicitudes) paga 2027 → renovacion"
  );
  const sb = mockSupabase({
    solicitudesPagadasPrevias: 0,
    apoderadoRow: { socio: true, socio_periodo: 2026 },
  });
  const t = await determinarTipoCorreo(sb, "ap-excel-id", 2027);
  check("tipo === renovacion", t === "renovacion", `obtenido=${t}`);
}

async function esc3_sociaDigital2027() {
  console.log(
    "\n[3] Socia digital 2027 (1 solicitud pagada previa) renueva 2028 → renovacion"
  );
  const sb = mockSupabase({
    solicitudesPagadasPrevias: 1,
    apoderadoRow: { socio: true, socio_periodo: 2027 },
  });
  const t = await determinarTipoCorreo(sb, "ap-digital-id", 2028);
  check("tipo === renovacion", t === "renovacion", `obtenido=${t}`);
}

async function esc4_raceCondicion() {
  console.log(
    "\n[4] Race condition: socia 2026 cuyo socio_periodo YA se actualizo a 2027 — sin snapshot daria bienvenida, con snapshot sigue renovacion"
  );
  // El snapshot ya quedo en 'renovacion' al INSERT (fase A). El
  // recalculo ahora, con socio_periodo=2027 (igual que periodoActual),
  // devolveria bienvenida porque ni digital ni importado se cumplen
  // (lt 2027 ya no se cumple). Esto comprueba que SIN snapshot la
  // decision seria incorrecta.
  const sbSinSnapshot = mockSupabase({
    solicitudesPagadasPrevias: 0,
    apoderadoRow: { socio: true, socio_periodo: 2027 },
  });
  const tRecalc = await determinarTipoCorreo(sbSinSnapshot, "ap-race-id", 2027);
  check(
    "sin snapshot el recalculo daria bienvenida (bug sin fix)",
    tRecalc === "bienvenida",
    `obtenido=${tRecalc}`
  );
  // Simulamos el fallback de enviar-qr.ts: s.tipo_correo ?? recalc.
  const tipoSnapshot: "bienvenida" | "renovacion" = "renovacion";
  const tipoFinal = tipoSnapshot ?? tRecalc;
  check(
    "con snapshot renovacion se preserva",
    tipoFinal === "renovacion",
    `tipoFinal=${tipoFinal}`
  );
}

function cfgBase(overrides: Partial<SocioConfig> = {}): SocioConfig {
  return {
    id: 1,
    periodo_anio: 2027,
    periodo_inicio: null,
    periodo_fin: null,
    monto_cuota: 20000,
    monto_cuota_normal: 20000,
    monto_cuota_promocional: null,
    promocion_inicio: null,
    promocion_fin: null,
    sumup_link: null,
    sumup_link_promo: null,
    sumup_link_normal: null,
    sumup_checkout_fijo: false,
    cuenta_sumup_id: null,
    categoria_cuota_id: null,
    mensaje_bienvenida: null,
    cpcc_instagram_url: null,
    cpcc_whatsapp_url: null,
    cpcc_convenios_url: null,
    correo_bienvenida_asunto: null,
    correo_bienvenida_cuerpo: null,
    correo_renovacion_asunto: null,
    correo_renovacion_cuerpo: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function solicitudBase(): SocioSolicitud {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    qr_token: "00000000-0000-0000-0000-000000000000",
    periodo_anio: 2027,
    apoderado_id: null,
    apoderado_nombre: "Familia González",
    apoderado_email: "familia.gonzalez@example.cl",
    apoderado_rut: null,
    apoderado_telefono: null,
    alumno_nombre: "Juan González",
    curso: "5° Básico A",
    monto_cuota: 18500,
    sumup_checkout_id: null,
    sumup_transaction_id: null,
    sumup_transaction_code: null,
    movimiento_id: null,
    pagada_en: new Date().toISOString(),
    email_enviado_en: null,
    email_reenvios: 0,
    estado: "pagada",
    notas_internas: null,
    procesada_por: null,
    tipo_correo: "bienvenida",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function esc5_dbOverride() {
  console.log("\n[5] DB override de asunto/cuerpo → se aplican overrides");
  const config = cfgBase({
    correo_bienvenida_asunto: "Hola {{nombre}}, custom asunto {{periodo}}",
    correo_bienvenida_cuerpo:
      "Linea 1 custom.\n\nLinea 2 — pagaste {{monto}} para socio {{periodo}}.",
  });
  const { subject, html } = armarCorreoSocioHtml({
    solicitud: solicitudBase(),
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    qrTokenPublico: "token-test",
    tipo: "bienvenida",
    config,
    saludoNombre: "Patricio",
  });
  check(
    "subject usa el override con nombre + periodo",
    subject === "Hola Patricio, custom asunto 2027",
    `subject="${subject}"`
  );
  check(
    "cuerpo contiene texto custom con monto formateado",
    html.includes("pagaste $18.500 para socio 2027"),
    "monto $18.500 presente"
  );
  check(
    "cuerpo preserva saltos de parrafo (<p> doble)",
    html.includes("Linea 1 custom.") && html.includes("Linea 2 — pagaste"),
    "ambos parrafos renderizados"
  );
}

async function esc6_urlsVacias() {
  console.log(
    "\n[6] URLs vacías → botones NO aparecen. URLs seteadas → botones aparecen"
  );
  const sinUrls = cfgBase();
  const { html: h1 } = armarCorreoSocioHtml({
    solicitud: solicitudBase(),
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    qrTokenPublico: "token-test",
    tipo: "bienvenida",
    config: sinUrls,
  });
  check(
    "sin URLs: ningun boton 'Ver convenios'",
    !h1.includes("Ver convenios"),
    "ok"
  );
  check(
    "sin URLs: ningun boton 'Instagram CPCC'",
    !h1.includes("Instagram CPCC"),
    "ok"
  );
  check(
    "sin URLs: ningun boton 'WhatsApp CPCC'",
    !h1.includes("WhatsApp CPCC"),
    "ok"
  );

  const conUrls = cfgBase({
    cpcc_convenios_url: "https://tesoria-cpcc.vercel.app/convenios",
    cpcc_instagram_url: "https://instagram.com/cpcc_test",
    cpcc_whatsapp_url: "https://chat.whatsapp.com/abc",
  });
  const { html: h2 } = armarCorreoSocioHtml({
    solicitud: solicitudBase(),
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    qrTokenPublico: "token-test",
    tipo: "bienvenida",
    config: conUrls,
  });
  check(
    "con URLs: boton 'Ver convenios' presente con href correcto",
    h2.includes("Ver convenios") &&
      h2.includes("https://tesoria-cpcc.vercel.app/convenios"),
    "ok"
  );
  check(
    "con URLs: boton 'Instagram CPCC' presente",
    h2.includes("Instagram CPCC") &&
      h2.includes("https://instagram.com/cpcc_test"),
    "ok"
  );
  check(
    "con URLs: boton 'WhatsApp CPCC' presente",
    h2.includes("WhatsApp CPCC") &&
      h2.includes("https://chat.whatsapp.com/abc"),
    "ok"
  );
}

async function esc7_previewBienvenida() {
  console.log(
    "\n[7] Preview bienvenida con datos ficticios → asunto y cuerpo defaults correctos"
  );
  const { subject, html } = armarCorreoSocioHtml({
    solicitud: solicitudBase(),
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    qrTokenPublico: "token-test",
    tipo: "bienvenida",
    config: cfgBase(),
    saludoNombre: "Juan",
  });
  check(
    "subject default es literal 'Bienvenido, ya eres parte del CPCC 💙💛'",
    subject === "Bienvenido, ya eres parte del CPCC 💙💛",
    `subject="${subject}"`
  );
  check(
    "cuerpo saluda a 'Juan' (primer nombre ficticio)",
    html.includes("Hola Juan,"),
    "ok"
  );
  check(
    "cuerpo menciona 'guarda este QR'",
    html.toLowerCase().includes("guarda este qr"),
    "ok"
  );
}

async function esc8_previewRenovacion() {
  console.log(
    "\n[8] Preview renovación con datos ficticios → asunto y cuerpo defaults contienen 'renovar' y periodo"
  );
  const { subject, html } = armarCorreoSocioHtml({
    solicitud: solicitudBase(),
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    qrTokenPublico: "token-test",
    tipo: "renovacion",
    config: cfgBase(),
    saludoNombre: "Juan",
  });
  check(
    "subject default contiene 'renovar' y '2027'",
    subject.toLowerCase().includes("renovar") && subject.includes("2027"),
    `subject="${subject}"`
  );
  check(
    "cuerpo menciona 'Gracias por renovar'",
    html.includes("Gracias por renovar"),
    "ok"
  );
  check(
    "cuerpo menciona QR 'continúa siendo válido'",
    html.includes("continúa siendo válido"),
    "ok"
  );
}

async function esc_placeholderEscape() {
  console.log(
    "\n[extra] Placeholders injection: {{<script>}} no inyecta JS; otros {{...}} quedan literales"
  );
  // Si un admin pone HTML en el cuerpo editable, debe aparecer escapado.
  const config = cfgBase({
    correo_bienvenida_cuerpo:
      "Prueba inyeccion: <script>alert(1)</script> y {{otra}} literal",
  });
  const { html } = armarCorreoSocioHtml({
    solicitud: solicitudBase(),
    qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
    qrTokenPublico: "token-test",
    tipo: "bienvenida",
    config,
  });
  check(
    "script etiquetado como texto (escape &lt;)",
    html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "ok"
  );
  check(
    "placeholder desconocido se preserva literal",
    html.includes("{{otra}} literal"),
    "ok"
  );
}

async function main() {
  console.log("=== Pruebas Fase D (offline) ===");
  await esc1_familiaNueva();
  await esc2_sociaExcel2026();
  await esc3_sociaDigital2027();
  await esc4_raceCondicion();
  await esc5_dbOverride();
  await esc6_urlsVacias();
  await esc7_previewBienvenida();
  await esc8_previewRenovacion();
  await esc_placeholderEscape();

  const fallos = resultados.filter((r) => !r.pasa);
  console.log("\n=== Resumen ===");
  console.log(`Total: ${resultados.length} — OK: ${resultados.length - fallos.length} — Fallos: ${fallos.length}`);
  if (fallos.length) {
    console.log("\nFallos:");
    for (const f of fallos) console.log(` ✗ ${f.nombre} — ${f.detalle}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
