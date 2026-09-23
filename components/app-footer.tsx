import Image from "next/image";

export function AppFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-xs text-slate-500">
      <div>
        Tesorería CPCC — Colegio Carampangue · {new Date().getFullYear()}
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-slate-400">
        <span>Proyecto desarrollado por</span>
        <Image
          src="/actyon.png"
          alt="Actyon Ingeniería Ltda."
          width={100}
          height={30}
          className="h-5 w-auto object-contain"
          priority={false}
        />
        <span>Ltda.</span>
      </div>
    </footer>
  );
}
