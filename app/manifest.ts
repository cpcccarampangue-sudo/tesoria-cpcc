import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tesorería CPCC — Colegio Carampangue",
    short_name: "Tesorería CPCC",
    description: "Sistema de tesorería del Centro de Padres",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1e3a8a",
    lang: "es-CL",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Accesos directos para delegados/directiva/convenios que solo
    // quieren validar QRs (no entrar al sistema de tesoreria).
    shortcuts: [
      {
        name: "Validar QR de socio",
        short_name: "Validar",
        description:
          "Escanea el QR de un apoderado y verifica si es socio activo del año en curso.",
        url: "/validar",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Incorporarse como socio",
        short_name: "Incorporarse",
        description:
          "Formulario público para registrarse como socio del CdP.",
        url: "/incorporacion",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
