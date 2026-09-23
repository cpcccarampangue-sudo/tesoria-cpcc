import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { ApoderadoForm } from "./apoderado-form";

export const metadata = { title: "Nuevo apoderado — Tesorería CPCC" };

export default async function NuevoApoderadoPage() {
  await requireDirectiva();
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <Link
          href="/apoderados"
          className="text-sm text-slate-600 hover:underline"
        >
          ← Volver a familias
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Nuevo apoderado</h1>
      <div className="card">
        <ApoderadoForm />
      </div>
    </div>
  );
}
