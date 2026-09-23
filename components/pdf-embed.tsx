"use client";

import { useEffect, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker de pdfjs servido desde CDN para no depender del pipeline de build.
// La version coincide con la de pdfjs-dist que trae react-pdf, asi que
// nunca queda desincronizado.
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export function PdfEmbed({
  url,
  maxWidth = 900,
}: {
  url: string;
  maxWidth?: number;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ancho, setAncho] = useState<number>(maxWidth);

  useEffect(() => {
    function onResize() {
      // Usa el ancho de la ventana (menos margen) para PDFs mas responsivos,
      // pero limita al maxWidth para que no queden gigantes en pantalla.
      const w = Math.min(window.innerWidth - 80, maxWidth);
      setAncho(Math.max(320, w));
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maxWidth]);

  if (error) {
    return (
      <div className="rounded border border-dashed border-red-300 bg-red-50 p-4 text-sm text-red-800">
        No se pudo renderizar el PDF ({error}).{" "}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline no-print"
        >
          Abrir en pestaña nueva
        </a>
      </div>
    );
  }

  return (
    <div className="pdf-embed flex flex-col items-center gap-3">
      <Document
        file={url}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadError={(err) => setError(err.message)}
        loading={
          <div className="text-sm text-slate-500 py-6">Cargando PDF...</div>
        }
      >
        {numPages &&
          Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              className="avoid-break border border-slate-100 shadow-sm mb-2 last:mb-0"
            >
              <Page
                pageNumber={i + 1}
                width={ancho}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </div>
          ))}
      </Document>
    </div>
  );
}
