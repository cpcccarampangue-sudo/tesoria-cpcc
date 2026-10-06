import Image from "next/image";
import Link from "next/link";
import { INSTITUCION_NOMBRE } from "@/lib/config";

type Props = {
  // Ruta activa para destacar el link correspondiente.
  activa: "incorporacion" | "validar";
  // Badge pequeno a la derecha del logo (ej. "SOCIOS 2027").
  badge?: string;
};

// Header institucional de las paginas publicas (/incorporacion, /validar).
// Mantiene coherencia visual con /login: logo CPCC + eyebrow azul institucional
// + badge naranja opcional. Nav con tabs activos marcados con color + linea
// inferior. En mobile la nav se reduce pero sigue siendo tactil (botones de
// 44px minimo).
export function PublicHeader({ activa, badge }: Props) {
  return (
    <header className="w-full bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-3 py-3 sm:py-4">
          <Link
            href="/incorporacion"
            className="flex items-center gap-3 min-w-0 flex-1 group"
          >
            <Image
              src="/logo.png"
              alt="Centro de Padres Colegio Carampangue"
              width={56}
              height={56}
              className="h-11 w-11 sm:h-12 sm:w-12 object-contain flex-shrink-0"
              priority
            />
            <div className="min-w-0 hidden sm:block">
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.14em] group-hover:opacity-80 transition-opacity"
                style={{ color: "#1e3a8a" }}
              >
                {INSTITUCION_NOMBRE}
              </p>
              <p className="text-sm font-semibold text-slate-900 leading-tight">
                Colegio Carampangue
              </p>
            </div>
          </Link>

          {badge && (
            <span
              className="inline-flex items-center h-7 px-2.5 rounded-full text-[11px] font-semibold tracking-wide text-white flex-shrink-0"
              style={{ background: "#F08C00" }}
            >
              {badge}
            </span>
          )}
        </div>

        <nav
          aria-label="Navegación principal"
          className="flex items-center gap-1 -mb-px"
        >
          <NavTab
            href="/incorporacion"
            label="Incorporación"
            active={activa === "incorporacion"}
          />
          <NavTab
            href="/validar"
            label="Validar socio"
            active={activa === "validar"}
          />
          <a
            href="#ayuda"
            className="ml-auto h-11 px-3 inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            <span className="hidden sm:inline">Ayuda</span>
            <span className="sm:hidden" aria-label="Ayuda">
              ?
            </span>
          </a>
        </nav>
      </div>
    </header>
  );
}

function NavTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`h-11 px-3 sm:px-4 inline-flex items-center text-sm font-medium border-b-2 transition-colors ${
        active
          ? "text-brand-700 border-brand-700"
          : "text-slate-500 border-transparent hover:text-slate-900 hover:border-slate-300"
      }`}
    >
      {label}
    </Link>
  );
}
