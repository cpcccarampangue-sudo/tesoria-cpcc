import Image from "next/image";

// Footer institucional de las paginas publicas. Mantiene coherencia con el
// footer del /login: copyright a la izquierda y logo ACTYON a la derecha.
export function PublicFooter() {
  const anio = new Date().getFullYear();
  return (
    <footer className="w-full border-t border-slate-200 bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
        <div className="text-center sm:text-left">
          © {anio} Centro de Padres Colegio Carampangue
        </div>
        <div className="flex items-center gap-2">
          <span>Desarrollado por</span>
          <Image
            src="/actyon.png"
            alt="Actyon Ingeniería"
            width={100}
            height={28}
            className="h-5 w-auto object-contain"
          />
        </div>
      </div>
    </footer>
  );
}
