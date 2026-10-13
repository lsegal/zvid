import { describe, expect, test } from "vitest";
import { readTextStyle } from "./fx/effects/text/text-style.ts";
import { resolveFontFace } from "./text-fonts.ts";
import { drawText } from "./text-render.ts";

// Text's dashed stroke (#1323), drawn with real Canvas 2D. The fill is
// transparent, so only the stroke shows, and the row sampled runs through
// the outer half of the underline's stroke, below every glyph.

const WIDTH = 600;
const HEIGHT = 200;

function strokedRow(numbers: Record<string, number>) {
  const style = readTextStyle({
    trackId: "1",
    effectName: "Text",
    parameters: [
      { key: "Text", value: "MMMM" },
      { key: "FontStyle", value: "Underline" },
      { key: "Color", value: "rgba(0,0,0,0)" },
      { key: "Stroke", value: "rgba(255,255,255,1)" },
      { key: "StrokeWidth", value: "4" },
      ...Object.entries(numbers).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    ],
  });
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const face = resolveFontFace(style.font, style.weight, style.italic);
  expect(drawText(canvas, style, face, WIDTH, HEIGHT, 1)).toBeDefined();
  const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
  const opaque = (x: number, y: number) =>
    pixels[(y * WIDTH + x) * 4 + 3] > 128;
  const row = (y: number) =>
    Array.from({ length: WIDTH }, (_, x) => opaque(x, y));
  // The lowest drawn row is the bottom of the underline's stroke.
  let bottom = HEIGHT - 1;
  while (bottom > 0 && !row(bottom).some(Boolean)) {
    bottom--;
  }
  return row(bottom - 2);
}

// The sampled row of a stroke, between the solid underline's ends, leaving
// out where its sides turn the corner.
function strokedSpan(numbers: Record<string, number>) {
  const solid = strokedRow({});
  return strokedRow(numbers).slice(
    solid.indexOf(true) + 10,
    solid.lastIndexOf(true) - 10,
  );
}

// The row's runs of equal pixels: each one's value and length.
function runs(row: boolean[]) {
  const found: Array<{ dash: boolean; length: number }> = [];
  for (const value of row) {
    const last = found.at(-1);
    if (last?.dash === value) {
      last.length++;
    } else {
      found.push({ dash: value, length: 1 });
    }
  }
  return found;
}

describe("Text stroke", () => {
  test("is solid with no Dash", () => {
    const row = strokedSpan({});
    expect(row.length).toBeGreaterThan(200);
    expect(row.every(Boolean)).toBe(true);
  });

  test("alternates dashes and gaps of the set lengths", () => {
    // The first and last runs are cut off by the sampled span.
    const inner = runs(strokedSpan({ StrokeDash: 20, StrokeGap: 30 })).slice(
      1,
      -1,
    );
    expect(inner.length).toBeGreaterThan(4);
    for (const run of inner) {
      expect(Math.abs(run.length - (run.dash ? 20 : 30))).toBeLessThanOrEqual(
        3,
      );
    }
  });

  test("Offset moves the dashes along the stroke", () => {
    const still = strokedSpan({ StrokeDash: 20, StrokeGap: 20 });
    const marched = strokedSpan({
      StrokeDash: 20,
      StrokeGap: 20,
      StrokeOffset: 20,
    });
    // Half a period on, dashes sit where the gaps were.
    const same = still.filter((value, index) => value === marched[index]);
    expect(same.length).toBeLessThan(still.length * 0.2);
  });
});
