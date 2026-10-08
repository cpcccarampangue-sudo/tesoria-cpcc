// Diagnostico mínimo del env SumUp en runtime. Protegido con
// requireDirectiva. No expone el valor completo de ningún secret.
// Eliminar junto con el resto de /api/debug/sumup-e2e/*.

import { NextResponse } from "next/server";
import { requireDirectiva } from "@/lib/auth";

export const dynamic = "force-dynamic";

function previewValue(v: string | undefined): string | null {
  if (!v) return null;
  if (v.length <= 20) return v.slice(0, 4) + "***";
  // Para URLs mostramos origen + path, enmascarando posibles query/secret.
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return v.slice(0, 20) + "***";
  }
}

function webhookNotificationUrl(): string {
  const explicit = process.env.SUMUP_WEBHOOK_URL;
  if (explicit) return explicit;
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://tesoreria.centropadrescarampangue.cl";
  return `${site.replace(/\/$/, "")}/api/webhooks/sumup`;
}

export async function GET() {
  await requireDirectiva();
  return NextResponse.json({
    ok: true,
    runtime: {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      VERCEL_URL: process.env.VERCEL_URL ?? null,
    },
    env_vars_sumup: {
      SUMUP_WEBHOOK_URL_present: !!process.env.SUMUP_WEBHOOK_URL,
      SUMUP_WEBHOOK_URL_preview: previewValue(process.env.SUMUP_WEBHOOK_URL),
      NEXT_PUBLIC_SITE_URL_present: !!process.env.NEXT_PUBLIC_SITE_URL,
      NEXT_PUBLIC_SITE_URL_preview: previewValue(
        process.env.NEXT_PUBLIC_SITE_URL
      ),
      SUMUP_MERCHANT_CODE_present: !!process.env.SUMUP_MERCHANT_CODE,
      SUMUP_API_KEY_present: !!process.env.SUMUP_API_KEY,
      SUMUP_WEBHOOK_SECRET_present: !!process.env.SUMUP_WEBHOOK_SECRET,
    },
    computed_webhook_notification_url: webhookNotificationUrl(),
    nota: "Si computed_webhook_notification_url NO comienza con https://tesoreria.centropadrescarampangue.cl, es porque SUMUP_WEBHOOK_URL no se esta leyendo. Verificar typo, scope (Production) o re-deploy.",
  });
}
