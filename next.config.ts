import type { NextConfig } from "next";

// Headers de seguridad aplicados a todas las rutas. Alineados con las
// recomendaciones de OWASP para apps web publicas.
const securityHeaders = [
  {
    // Fuerza HTTPS por 1 ano, incluyendo subdominios. Solo afecta a hosts
    // reales (en localhost no se activa). Preload=false para no requerir
    // inclusion en la lista de hsts-preload (requiere auditoria externa).
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    // Impide que el navegador infiera un Content-Type distinto al servido.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Impide que la app se cargue dentro de un iframe en otros origenes
    // (proteccion contra clickjacking). Equivalente a frame-ancestors 'none'.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    // Al navegar fuera del sitio, el Referer se recorta a solo el origen.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Deshabilita APIs potentes que la app no necesita. Camera queda
    // habilitada para self porque la usa /validar para escanear QR.
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
  {
    // CSP permisiva pero defendida: scripts solo de self + inline con nonce
    // (Next.js lo necesita), estilos inline (Tailwind JIT los emite),
    // imagenes desde self, data URL (para QR embebido) y blob.
    // En connect-src: self + Supabase (desde env) + SumUp API + Resend.
    // La lista completa de dominios se compone dinamicamente en runtime,
    // aqui dejamos una base conservadora que cubre lo publico.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inyecta scripts inline con nonces/hashes, por eso 'unsafe-inline';
      // react-pdf necesita blob worker.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdnjs.cloudflare.com",
      // Tailwind JIT y estilos inline del Next App Router.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // Supabase + SumUp + Resend se agregan en runtime via headers del middleware
      // si fuera necesario; para la mayoria de endpoints self es suficiente.
      "connect-src 'self' https: wss:",
      // Para html5-qrcode que usa workers.
      "worker-src 'self' blob:",
      "frame-src https://api.sumup.com https://pay.sumup.com https://checkout.sumup.com",
      // Impide carga en iframe cross-origin (redundante con X-Frame-Options).
      "frame-ancestors 'none'",
      "object-src 'none'",
      // Impide que un atacante inyecte un formulario POST a un dominio externo.
      "form-action 'self' https://pay.sumup.com https://checkout.sumup.com",
      "base-uri 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
