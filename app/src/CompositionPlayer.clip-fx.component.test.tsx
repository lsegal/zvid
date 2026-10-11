import { describe, expect, test } from "vitest";
import type { ArrangementClip } from "./app/types.ts";
import { CompositionRenderer } from "./CompositionPlayer";
import type { SessionEffect } from "./fx-stack.ts";

// Clip-level FX stacks, rendered in real WebGL and sampled: a clip's own
// chain runs before its layer's, the Global chain runs last on the
// composite, and a clip's Transform places the clip inside its layer's
// transformed box.

type Rgb = [number, number, number];

const WIDTH = 100;
const HEIGHT = 100;

// One full-canvas red fill clip, "fill-1" on Layer 1, drawn with `effects`
// (its layer's red Color is added). Returns the pixels at `samples`, given
// as fractions of the canvas width and height from its top-left corner.
async function renderPixels(
  effects: SessionEffect[],
  samples: Array<[number, number]>,
): Promise<Rgb[]> {
  const lanes = [{ id: "1", name: "Layer 1", colorIndex: 0 }];
  const clips: ArrangementClip[] = [
    {
      id: "fill-1",
      kind: "fill",
      sourceSpanId: "",
      sourceTrackId: "",
      laneId: "1",
      label: "Fill",
      mediaPath: "",
      startQ: 0,
      durationSeconds: 4,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 4,
      tint: "#000",
      accent: "#fff",
    },
  ];
  const color: SessionEffect = {
    id: "color-1",
    trackId: "1",
    effectName: "Color",
    enabled: true,
    parameters: [
      { key: "Mode", value: "Solid" },
      { key: "Color", value: "#ff0000" },
      { key: "Opacity", value: "1", numericValue: 1 },
    ],
  };

  const canvas = document.createElement("canvas");
  const renderer = new CompositionRenderer(
    {
      mediaItems: [],
      clips,
      lanes,
      effects: [color, ...effects],
      bpm: 120,
      fps: 30,
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
    },
    { canvas, audioAnalysis: "offline" },
  );
  try {
    await renderer.renderFrameAt(1, 0.5);
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is unavailable.");
    return samples.map(([x, y]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(x * WIDTH),
        HEIGHT - 1 - Math.floor(y * HEIGHT),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return [pixel[0], pixel[1], pixel[2]];
    });
  } finally {
    renderer.destroy();
  }
}

function effect(
  id: string,
  trackId: string,
  effectName: string,
  parameters: Record<string, number>,
): SessionEffect {
  return {
    id,
    trackId,
    effectName,
    enabled: true,
    parameters: Object.entries(parameters).map(([key, value]) => ({
      key,
      value: String(value),
      numericValue: value,
    })),
  };
}

// NegativeSplit inverts dark colors with Low and bright ones with High.
// Red is dark and its inverse, cyan, is bright, so the three inversions
// below only end on cyan in the order Clip, Layer, Global:
//   clip (dark → invert): red → cyan; layer (bright → invert): cyan → red;
//   Global (all): red → cyan.
// Layer before clip ends on red (the layer leaves dark red alone, the clip
// inverts it, Global inverts it back), and so does Global first.
const invertDark = { _LowIntensity: 1, _HighIntensity: 0 };
const invertBright = { _LowIntensity: 0, _HighIntensity: 1 };
const invertAll = { _LowIntensity: 1, _HighIntensity: 1 };

function expectColor(actual: Rgb, expected: Rgb) {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs(actual[index] - value), `rgb(${actual})`).toBeLessThan(8);
  }
}

describe("CompositionRenderer clip FX stacks", () => {
  test("runs a clip's chain, then its layer's, then Global's", async () => {
    const [center] = await renderPixels(
      [
        effect("global", "__group_main", "NegativeSplit", invertAll),
        effect("layer", "1", "NegativeSplit", invertBright),
        effect("clip", "clip:fill-1", "NegativeSplit", invertDark),
      ],
      [[0.5, 0.5]],
    );
    expectColor(center, [0, 255, 255]);
  });

  test("applies a clip's chain to that clip only", async () => {
    const [center] = await renderPixels(
      [effect("other", "clip:fill-2", "NegativeSplit", invertAll)],
      [[0.5, 0.5]],
    );
    expectColor(center, [255, 0, 0]);
  });

  test("places a clip's Transform inside its layer's Transform", async () => {
    // The clip is half as wide in the middle of the layer's box, [0.25, 0.75]
    // of the canvas, and the layer then moves right by a quarter: [0.5, 1].
    const [leftOfClip, insideClip, background] = await renderPixels(
      [
        effect("layer-transform", "1", "Transform", { PositionX: 0.25 }),
        effect("clip-transform", "clip:fill-1", "Transform", { ScaleX: 0.5 }),
      ],
      [
        [0.4, 0.5],
        [0.75, 0.5],
        [0.1, 0.5],
      ],
    );
    expectColor(insideClip, [255, 0, 0]);
    // Scaling the moved box about the canvas center instead would cover 0.4.
    expect(leftOfClip[0], `rgb(${leftOfClip})`).toBeLessThan(64);
    expect(background[0], `rgb(${background})`).toBeLessThan(64);
  });
});
