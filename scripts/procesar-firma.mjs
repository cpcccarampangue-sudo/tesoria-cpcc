// Script util para quitar el fondo de una firma escaneada.
// Convierte a escala de grises y usa el brillo como canal alpha:
// pixeles claros (papel) -> transparentes, pixeles oscuros (tinta) -> negros.
// Uso: node scripts/procesar-firma.mjs <input> <output>

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error("Uso: node procesar-firma.mjs <input.png> <output.png>");
  process.exit(1);
}

// Rangos de umbral (0-255):
// - Pixel >= LIGHT_CUTOFF (muy claro/papel) -> totalmente transparente
// - Pixel <= DARK_CUTOFF (muy oscuro/tinta) -> totalmente opaco negro
// - En el medio -> alpha proporcional, para preservar antialiasing en bordes
// Umbrales agresivos para eliminar textura de papel y ruido de escaneo.
const LIGHT_CUTOFF = 110;
const DARK_CUTOFF = 50;

const { data, info } = await sharp(inputArg)
  .grayscale()
  .normalise() // estira el histograma para maximizar contraste tinta/papel
  .median(1) // filtro suave para atenuar textura de papel
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height } = info;
const out = Buffer.alloc(width * height * 4); // RGBA

for (let i = 0; i < width * height; i++) {
  const gray = data[i];
  let alpha;
  if (gray >= LIGHT_CUTOFF) alpha = 0;
  else if (gray <= DARK_CUTOFF) alpha = 255;
  else
    alpha = Math.round(
      ((LIGHT_CUTOFF - gray) / (LIGHT_CUTOFF - DARK_CUTOFF)) * 255
    );

  out[i * 4] = 0; // R
  out[i * 4 + 1] = 0; // G
  out[i * 4 + 2] = 0; // B
  out[i * 4 + 3] = alpha;
}

await sharp(out, { raw: { width, height, channels: 4 } })
  .trim({ threshold: 5 }) // recorta bordes vacios
  .png()
  .toFile(outputArg);

console.log(`Firma limpia guardada en: ${outputArg}`);
console.log(`Dimensiones: ${width}x${height}`);
