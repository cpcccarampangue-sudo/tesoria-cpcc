import type { CartolaParseada } from "@/lib/types";
import { parseCartolaBancoEstado } from "./parser-banco-estado";
import { parseCartolaBancoChile } from "./parser-banco-chile";

export type BancoSoportado = "banco_estado" | "banco_chile";

export const BANCOS_SOPORTADOS: BancoSoportado[] = [
  "banco_estado",
  "banco_chile",
];

export function parseCartola(
  banco: string | null,
  buffer: ArrayBuffer
): CartolaParseada {
  switch (banco) {
    case "banco_estado":
      return parseCartolaBancoEstado(buffer);
    case "banco_chile":
      return parseCartolaBancoChile(buffer);
    default:
      throw new Error(
        `Aún no hay parser para el banco "${banco ?? "?"}". Bancos soportados: ${BANCOS_SOPORTADOS.join(", ")}.`
      );
  }
}

export { parseCartolaBancoEstado, parseCartolaBancoChile };
