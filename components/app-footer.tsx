import Image from "next/image";

export function AppFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-3 px-4 text-xs text-slate-500">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div>
          © {new Date().getFullYear()} Tesorería CPCC — Colegio Carampangue
        </div>
        <div className="flex items-center gap-2">
          <span>Desarrollado por</span>
          <Image
            src="/actyon.png"
            alt="Actyon Ingeniería Ltda."
            width={120}
            height={36}
            className="h-6 w-auto object-contain"
            priority={false}
          />
        </div>
      </div>
    </footer>
  );
}
