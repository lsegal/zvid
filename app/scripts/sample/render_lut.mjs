// Writes `public/samples/opening-v2/warm-film.cube`, the opening sample's
// LUT: an original warm film grade made for zvid. It lifts the blacks,
// rolls off the highlights, pulls the shadows toward teal and the
// highlights toward amber, and takes a little saturation out.
//
//   node app/scripts/sample/render_lut.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = resolve(APP, "public/samples/opening-v2/warm-film.cube");
const SIZE = 17;

const clamp = (value) => Math.max(0, Math.min(1, value));

// A gentle S-curve with lifted blacks and soft highlights.
function tone(value) {
  const curved = value * value * (3 - 2 * value);
  return 0.06 + 0.88 * (0.55 * curved + 0.45 * value);
}

function grade(r, g, b) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Shadows lean teal, highlights amber.
  const warmth = luma - 0.5;
  const shifted = [r + 0.08 * warmth, g + 0.02 * warmth, b - 0.1 * warmth];
  const desaturated = shifted.map((value) => luma + (value - luma) * 0.85);
  return desaturated.map((value) => clamp(tone(clamp(value))));
}

const lines = [
  'TITLE "zvid Warm Film"',
  "# An original warm film grade made for zvid by",
  "# app/scripts/sample/render_lut.mjs.",
  `LUT_3D_SIZE ${SIZE}`,
  "DOMAIN_MIN 0.0 0.0 0.0",
  "DOMAIN_MAX 1.0 1.0 1.0",
];
for (let b = 0; b < SIZE; b++) {
  for (let g = 0; g < SIZE; g++) {
    for (let r = 0; r < SIZE; r++) {
      const color = grade(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1));
      lines.push(color.map((value) => value.toFixed(6)).join(" "));
    }
  }
}
writeFileSync(FILE, `${lines.join("\n")}\n`);
console.log(`Wrote ${FILE}`);
