import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { NavLink } from "@/components/nav-link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const esDirectiva = profile.role === "directiva";

  const navDirectiva = [
    { href: "/dashboard", label: "Inicio" },
    { href: "/movimientos", label: "Movimientos" },
    { href: "/cuotas", label: "Cuotas" },
    { href: "/eventos", label: "Eventos" },
    { href: "/apoderados", label: "Apoderados" },
    { href: "/categorias", label: "Categorías" },
    { href: "/reportes", label: "Reportes" },
  ];

  const navApoderado = [
    { href: "/dashboard", label: "Inicio" },
    { href: "/cuotas", label: "Mis cuotas" },
    { href: "/eventos", label: "Eventos" },
  ];

  const nav = esDirectiva ? navDirectiva : navApoderado;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-brand-600 text-xl font-bold">₡</span>
            <span className="font-semibold text-slate-900">
              Tesorería CPCC
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 hidden sm:inline">
              {profile.email}
              {esDirectiva && (
                <span className="badge-blue ml-2">Directiva</span>
              )}
            </span>
            <form action="/logout" method="post">
              <button type="submit" className="btn-secondary text-xs">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
        Tesorería CPCC — {new Date().getFullYear()}
      </footer>
    </div>
  );
}
