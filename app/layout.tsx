import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tesorería CPCC",
  description: "Sistema de cuentas del Centro de Padres",
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
