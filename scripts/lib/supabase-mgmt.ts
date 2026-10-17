// Cliente mínimo contra la Supabase Management API.
//
// Lee SUPABASE_ACCESS_TOKEN desde .env.local (ya en .gitignore) y lo
// usa como Bearer token hacia https://api.supabase.com. El PAT debe
// crearse en https://supabase.com/dashboard/account/tokens con alcance
// "Database" + "Migrations Read-write" restringido al proyecto CPCC.
//
// IMPORTANTE: este modulo nunca debe imprimir el token completo.
// Para fines de diagnostico expone solo la longitud o un hash corto.

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

export const PROJECT_REF = "aotgbavokblzjdjwrxnh";
const API_BASE = "https://api.supabase.com/v1";

export function cargarEnvLocal(): void {
  try {
    const envText = readFileSync(".env.local", "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k]) continue;
      process.env[k] = v.replace(/^["']|["']$/g, "");
    }
  } catch {
    // sigue con env del shell
  }
}

export function getToken(): string {
  cargarEnvLocal();
  const t = process.env.SUPABASE_ACCESS_TOKEN;
  if (!t || !t.trim()) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN no está definido en .env.local. " +
        "Pega el Personal Access Token con alcance Database + Migrations Read-write."
    );
  }
  return t.trim();
}

// Diagnostico sin filtrar: imprime solo longitud y 10 chars de hash.
export function tokenHuella(): { length: number; sha10: string } {
  const t = getToken();
  const sha = crypto.createHash("sha256").update(t).digest("hex").slice(0, 10);
  return { length: t.length, sha10: sha };
}

export type SqlRow = Record<string, unknown>;

export type SqlResult = {
  rows: SqlRow[];
  // Supabase devuelve a veces un objeto {code,message,hint} si falla.
  raw: unknown;
};

// Ejecuta SQL arbitrario via Management API.
// La API devuelve el resultado del ultimo statement si hay varios;
// para migraciones esto no es un problema porque usamos un unico bloque.
// Si el servidor devuelve codigo != 2xx, lanza con mensaje humano SIN
// token en la URL.
export async function execSql(query: string): Promise<SqlResult> {
  const token = getToken();
  const url = `${API_BASE}/projects/${PROJECT_REF}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const bodyText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = bodyText;
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : String(bodyText).slice(0, 500);
    throw new Error(`Management API ${res.status}: ${msg}`);
  }
  if (Array.isArray(parsed)) {
    return { rows: parsed as SqlRow[], raw: parsed };
  }
  return { rows: [], raw: parsed };
}
