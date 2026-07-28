import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Tesorería CPCC — Colegio Carampangue",
  description: "Sistema de cuentas del Centro de Padres",
  applicationName: "Tesorería CPCC",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tesorería CPCC",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: { url: "/apple-icon-180.png", sizes: "180x180", type: "image/png" },
    shortcut: "/favicon-32.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e3a8a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
