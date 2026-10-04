import { BLACK, type TransitionTypeDefinition } from "../type.ts";

// Each square flips over in this share of the transition.
const FLIP = 0.2;
// The squares of one color start flipping first, the rest this much
// later, and within each color the columns start left to right over this
// much, so the last square finishes as the transition does.
const COLOR_DELAY = 0.4;
const COLUMN_DELAY = 1 - FLIP - COLOR_DELAY;

// The picture is cut into a checkerboard Count squares across, and each
// square flips over like a card, A on its front and B on its back, one
// color after the other and left to right.
export const transitionType: TransitionTypeDefinition = {
  name: "Checkerboard",
  menuOrder: 180,
  options: ["count"],
  glsl: `
    float columns = max(floor(uCount + 0.5), 1.0);
    vec2 cells = uv * uResolution / (uResolution.x / columns);
    vec2 cell = floor(cells);
    float color = mod(cell.x + cell.y, 2.0);
    float start = color * ${COLOR_DELAY.toFixed(6)}
      + cell.x / max(columns - 1.0, 1.0) * ${COLUMN_DELAY.toFixed(6)};
    float flip = clamp((p - start) / ${FLIP.toFixed(6)}, 0.0, 1.0);
    float across = abs(fract(cells.x) - 0.5);
    if (across > 0.5 * abs(cos(flip * 3.141593))) return vec4(0.0, 0.0, 0.0, 1.0);
    return flip < 0.5 ? compA(uv) : compB(uv);
  `,
  render({ a, b, count, resolution }, uv, p) {
    const columns = Math.max(Math.round(count), 1);
    const size = resolution[0] / columns;
    const x = (uv[0] * resolution[0]) / size;
    const y = (uv[1] * resolution[1]) / size;
    const column = Math.floor(x);
    const color = (column + Math.floor(y)) % 2;
    const start =
      color * COLOR_DELAY + (column / Math.max(columns - 1, 1)) * COLUMN_DELAY;
    const flip = Math.max(0, Math.min(1, (p - start) / FLIP));
    const across = Math.abs(x - column - 0.5);
    if (across > 0.5 * Math.abs(Math.cos(flip * Math.PI))) {
      return BLACK;
    }
    return flip < 0.5 ? a(uv) : b(uv);
  },
};
