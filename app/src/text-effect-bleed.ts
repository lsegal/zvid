import type { FrameBounds } from "./composition-layout.ts";
import {
  type Box,
  type CanvasSize,
  canvasBoxToFrame,
} from "./composition-transform.ts";
import type { PreparedEffectStep } from "./fx-shaders/chain.ts";
import type { EffectContext } from "./fx-shaders/types.ts";

// A text clip's effects run on its box's own frame, so whatever spreads the
// text outward, such as Motion Blur, Gaussian Blur or Bloom, would stop at
// the box's edges. The frame is padded by how far its chain spreads it, so
// the smear or glow trails past the box instead.

export type Bleed = { x: number; y: number };

export const NO_BLEED: Bleed = { x: 0, y: 0 };

// Pixels added past the spread, for the reads a blur's last taps take
// between texels.
const BLEED_MARGIN = 2;

// Spreads shorter than this, such as a vertical smear's rounding across,
// spread nothing.
const MIN_SPREAD = 1e-3;

// Rounds of growing the padding until it holds a spread that grows with the
// picture, as Bloom's does. Each round the shortfall shrinks by the share
// of the picture such spreads reach, a quarter at most per Bloom.
const BLEED_ROUNDS = 4;

// How far `steps` spread their picture past a `box`, each side, in the
// box's pixels. `pixelScale` is the box's pixels per output pixel at 1080p.
// The spreads of passes in a chain add up, and a chain that spreads nothing
// leaves the box as it is. Merged steps hold only per-pixel passes after
// their first, and a pass that spreads draws stages, so it is never merged.
export function chainBleed(
  steps: PreparedEffectStep[],
  box: { width: number; height: number },
  pixelScale: number,
): Bleed {
  const spreading = steps.filter((step) => step.compiled.pass.spread);
  let bleed = NO_BLEED;
  if (!spreading.length) {
    return bleed;
  }
  for (let round = 0; round < BLEED_ROUNDS; round++) {
    const ctx: EffectContext = {
      time: 0,
      clipProgress: 0,
      resolution: [box.width + 2 * bleed.x, box.height + 2 * bleed.y],
      bottomUp: false,
      pixelScale,
    };
    let x = 0;
    let y = 0;
    for (const { compiled, parameters } of spreading) {
      const [across, up] = compiled.pass.spread?.(parameters, ctx) ?? [0, 0];
      x += across;
      y += up;
    }
    const next = {
      x: x > MIN_SPREAD ? Math.ceil(x + BLEED_MARGIN) : 0,
      y: y > MIN_SPREAD ? Math.ceil(y + BLEED_MARGIN) : 0,
    };
    if (next.x === bleed.x && next.y === bleed.y) {
      break;
    }
    bleed = next;
  }
  return bleed;
}

// `box` grown by `bleed` on every side.
export function padBox(box: Box, bleed: Bleed): Box {
  return {
    x: box.x - bleed.x,
    y: box.y - bleed.y,
    width: box.width + 2 * bleed.x,
    height: box.height + 2 * bleed.y,
  };
}

// `placement` with its frame grown around a text `box` by how far `steps`
// spread it (see `chainBleed`), and how much that grows each side. Anything
// but text, and text whose chain spreads nothing, keeps its frame.
export function bleedTextPlacement<Placement extends { frame: FrameBounds }>(
  placement: Placement,
  box: Box | undefined,
  steps: PreparedEffectStep[],
  canvas: CanvasSize,
  pixelScale: number,
) {
  const bleed = box ? chainBleed(steps, box, pixelScale) : NO_BLEED;
  if (!box || !(bleed.x || bleed.y)) {
    return { placement, grow: { x: 1, y: 1 } };
  }
  const padded = padBox(box, bleed);
  return {
    placement: { ...placement, frame: canvasBoxToFrame(padded, canvas) },
    grow: {
      x: padded.width / Math.max(1e-6, box.width),
      y: padded.height / Math.max(1e-6, box.height),
    },
  };
}
