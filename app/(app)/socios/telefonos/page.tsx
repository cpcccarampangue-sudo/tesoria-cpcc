import Link from "next/link";
import { requireDirectiva } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  clasificarTelefonoCL,
  normalizarTelefonoCL,
} from "@/lib/normalizar";

// Reporte administrativo de telefonos a regularizar. Vista solo-lectura
// para que la directiva vea rapidamente que socios necesitan actualizar
// datos. NO modifica nada: la correccion se hace desde /apoderados/[id].
//
// Agrupa por familia (apoderado) y, para cada familia, muestra el
// contacto con mejor telefono y lo clasifica:
//   - sin_telefono:  ningun contacto activo tiene telefono.
//   - invalidos:     algun contacto tiene telefono pero no se puede
//                    normalizar (ni ya normalizado, ni normalizable).
//   - normalizables: al menos un telefono se puede normalizar pero
//                    no esta en formato canonico +56XXXXXXXXX todavia.
//   - validos:       al menos un telefono ya esta en formato canonico.
// Una familia puede caer en varios cubos si tiene varios contactos;
// aqui priorizamos "peor estado" para efectos de regularizacion.

export const metadata = {
  title: "Teléfonos a regularizar — Tesorería CPCC",
};
export const dynamic = "force-dynamic";

type ContactoRow = {
  id: string;
  apoderado_id: string;
  nombre: string | null;
  telefono: string | null;
  activo: boolean | null;
};

type ApoderadoRow = {
  id: string;
  nombre: string | null;
  activo: boolean | null;
};

type EstadoFamilia =
  | "sin_telefono"
  | "invalido"
  | "normalizable"
  | "valido";

type FamiliaItem = {
  apoderadoId: string;
  nombreFamilia: string;
  // Mejor telefono encontrado y su clasificacion (el mas "legible").
  mejorTelefonoRaw: string | null;
  mejorTelefonoNorm: string | null;
  estado: EstadoFamilia;
  totalContactos: number;
};

function peorEstado(a: EstadoFamilia, b: EstadoFamilia): EstadoFamilia {
  const orden: EstadoFamilia[] = [
    "valido",
    "normalizable",
    "invalido",
    "sin_telefono",
  ];
  return orden.indexOf(a) < orden.indexOf(b) ? b : a;
}

export default async function TelefonosReportePage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  await requireDirectiva();
  const sp = await searchParams;
  const filtroInput = (sp.filtro ?? "").toString();
  const filtro =
    filtroInput === "sin_telefono" ||
    filtroInput === "invalido" ||
    filtroInput === "normalizable"
      ? filtroInput
      : "a_revisar";

  const supabase = await createSupabaseServerClient();
  const { data: apData } = await supabase
    .from("apoderados")
    .select("id, nombre, activo")
    .eq("activo", true)
    .order("nombre", { ascending: true });
  const apoderados = (apData as ApoderadoRow[] | null) ?? [];

  const ids = apoderados.map((a) => a.id);
  const { data: ctxData } =
    ids.length > 0
      ? await supabase
          .from("contactos")
          .select("id, apoderado_id, nombre, telefono, activo")
          .in("apoderado_id", ids)
          .eq("activo", true)
      : { data: [] as ContactoRow[] };
  const contactosPorFamilia = new Map<string, ContactoRow[]>();
  for (const c of (ctxData as ContactoRow[] | null) ?? []) {
    const lista = contactosPorFamilia.get(c.apoderado_id) ?? [];
    lista.push(c);
    contactosPorFamilia.set(c.apoderado_id, lista);
  }

  const items: FamiliaItem[] = apoderados.map((a) => {
    const contactos = contactosPorFamilia.get(a.id) ?? [];
    if (contactos.length === 0) {
      return {
        apoderadoId: a.id,
        nombreFamilia: a.nombre ?? "—",
        mejorTelefonoRaw: null,
        mejorTelefonoNorm: null,
        estado: "sin_telefono",
        totalContactos: 0,
      };
    }
    let estadoAgg: EstadoFamilia = "sin_telefono";
    let mejorRaw: string | null = null;
    let mejorNorm: string | null = null;
    for (const c of contactos) {
      const clase = clasificarTelefonoCL(c.telefono);
      const estadoC: EstadoFamilia =
        clase === "ausente"
          ? "sin_telefono"
          : clase === "invalido"
            ? "invalido"
            : clase === "normalizable"
              ? "normalizable"
              : "valido";
      // Para la vista preferimos mostrar el "mejor" (valido > normalizable
      // > invalido > sin_telefono); el estado agregado es el peor para
      // ordenar/filtrar.
      estadoAgg = peorEstado(estadoAgg, estadoC);
      if (
        (estadoC === "valido" && mejorRaw === null) ||
        (estadoC === "valido" && mejorNorm === null) ||
        (mejorNorm === null && (estadoC === "normalizable" || estadoC === "valido"))
      ) {
        mejorRaw = c.telefono;
        mejorNorm = normalizarTelefonoCL(c.telefono);
      }
      if (mejorRaw === null && c.telefono) {
        mejorRaw = c.telefono;
      }
    }
    // Si todos tenian telefono invalido, mostramos uno de ellos para que
    // la directiva lo vea.
    return {
      apoderadoId: a.id,
      nombreFamilia: a.nombre ?? "—",
      mejorTelefonoRaw: mejorRaw,
      mejorTelefonoNorm: mejorNorm,
      estado: estadoAgg,
      totalContactos: contactos.length,
    };
  });

  const totales = {
    valido: items.filter((i) => i.estado === "valido").length,
    normalizable: items.filter((i) => i.estado === "normalizable").length,
    invalido: items.filter((i) => i.estado === "invalido").length,
    sin_telefono: items.filter((i) => i.estado === "sin_telefono").length,
  };

  const lista = items.filter((i) => {
    if (filtro === "a_revisar") return i.estado !== "valido";
    return i.estado === filtro;
  });

  const estadoLabel: Record<EstadoFamilia, string> = {
    valido: "Válido",
    normalizable: "Formato a corregir",
    invalido: "Inválido",
    sin_telefono: "Sin teléfono",
  };
  const estadoClase: Record<EstadoFamilia, string> = {
    valido: "bg-green-50 text-green-800 border-green-200",
    normalizable: "bg-amber-50 text-amber-800 border-amber-200",
    invalido: "bg-red-50 text-red-800 border-red-200",
    sin_telefono: "bg-slate-50 text-slate-700 border-slate-200",
  };

  const filtros: Array<{ value: string; label: string; count: number }> = [
    {
      value: "a_revisar",
      label: "A revisar",
      count: totales.sin_telefono + totales.invalido + totales.normalizable,
    },
    {
      value: "sin_telefono",
      label: "Sin teléfono",
      count: totales.sin_telefono,
    },
    { value: "invalido", label: "Inválidos", count: totales.invalido },
    {
      value: "normalizable",
      label: "A normalizar",
      count: totales.normalizable,
    },
  ];

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Teléfonos a regularizar
          </h1>
          <p className="text-sm text-slate-500">
            Familias cuyos teléfonos no están en el formato{" "}
            <code className="font-mono">+56XXXXXXXXX</code> o faltan. La
            corrección se hace desde la ficha de cada apoderado.
          </p>
        </div>
        <Link href="/socios" className="btn-secondary text-sm">
          ← Volver a socios
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { k: "valido", label: "Válidos" },
          { k: "normalizable", label: "Formato a corregir" },
          { k: "invalido", label: "Inválidos" },
          { k: "sin_telefono", label: "Sin teléfono" },
        ].map((x) => (
          <div
            key={x.k}
            className={
              "card border " +
              estadoClase[x.k as EstadoFamilia] +
              " flex flex-col"
            }
          >
            <span className="text-xs uppercase tracking-wider font-medium opacity-80">
              {x.label}
            </span>
            <span className="text-2xl font-semibold mt-0.5">
              {(totales as Record<string, number>)[x.k]}
            </span>
          </div>
        ))}
      </div>

      <form method="GET" className="card flex items-end gap-3 flex-wrap">
        <div>
          <label className="label">Filtro</label>
          <select name="filtro" defaultValue={filtro} className="input">
            {filtros.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} ({f.count})
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary">Aplicar</button>
        <p className="text-xs text-slate-500 flex-1 min-w-[240px]">
          Total familias activas: <strong>{items.length}</strong>.
        </p>
      </form>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Familia</th>
              <th className="table-th">Estado</th>
              <th className="table-th">Teléfono registrado</th>
              <th className="table-th">Normalizaría a</th>
              <th className="table-th text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lista.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  Nada que mostrar en este filtro.
                </td>
              </tr>
            ) : (
              lista.map((i) => (
                <tr key={i.apoderadoId}>
                  <td className="table-td">
                    <div className="font-medium">{i.nombreFamilia}</div>
                    <div className="text-xs text-slate-500">
                      {i.totalContactos} contacto
                      {i.totalContactos === 1 ? "" : "s"} activo
                      {i.totalContactos === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="table-td">
                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium " +
                        estadoClase[i.estado]
                      }
                    >
                      {estadoLabel[i.estado]}
                    </span>
                  </td>
                  <td className="table-td font-mono text-xs">
                    {i.mejorTelefonoRaw ?? (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="table-td font-mono text-xs">
                    {i.mejorTelefonoNorm ?? (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="table-td text-right">
                    <Link
                      href={`/apoderados/${i.apoderadoId}`}
                      className="text-brand-700 hover:underline text-sm"
                    >
                      Editar ficha →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
