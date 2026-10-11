import { describe, expect, test } from "vitest";
import type { ArrangementClip, Lane } from "./app/types.ts";
import { CompositionRenderer } from "./CompositionPlayer.tsx";
import type { SessionEffect } from "./fx-stack";
import { resolveRenderClips } from "./render-clips.ts";

// A hidden layer (#1026) draws nothing and takes no Order slot, but can
// still be a Mask's Target, so a Shape layer can mask another without
// drawing itself. The clips resolve as the app resolves them, through
// resolveRenderClips, and are rendered in real WebGL and sampled.

type Rgb = [number, number, number];

type Effect = {
  id: string;
  trackId: string;
  effectName: string;
  enabled: boolean;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
};

// A layer's one clip, 0-4 s: a fill of a color.
type Layer = { fill: string; hidden?: boolean };

type Scenario = {
  // Layers, from Layer 1 down.
  layers: Layer[];
  effects: Effect[];
  samples: Array<[number, number]>;
};

const SIZE = 120;

// Renders the layers at 1 s and returns the pixels at `samples`, fractions
// of the canvas from its top-left corner.
async function render({ layers, effects, samples }: Scenario): Promise<Rgb[]> {
  const lanes: Lane[] = layers.map((layer, index) => ({
    id: `${index + 1}`,
    name: `Layer ${index + 1}`,
    colorIndex: index,
    ...(layer.hidden ? { hidden: true } : {}),
  }));
  const clips: ArrangementClip[] = layers.map((_, index) => ({
    id: `fill-${index + 1}`,
    kind: "fill",
    sourceSpanId: "",
    sourceTrackId: "",
    laneId: `${index + 1}`,
    label: "fill",
    mediaPath: "",
    startQ: 0,
    durationSeconds: 4,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 4,
    tint: "#000",
    accent: "#fff",
  }));
  const colors: Effect[] = layers.map((layer, index) => ({
    id: `color-${index + 1}`,
    trackId: `${index + 1}`,
    effectName: "Color",
    enabled: true,
    parameters: [
      { key: "Mode", value: "Solid" },
      { key: "Color", value: layer.fill },
      { key: "Opacity", value: "1", numericValue: 1 },
    ],
  }));
  const rendered = resolveRenderClips({
    clips,
    lanes,
    sourceTracks: [],
    sourceSpans: [],
    bpm: 120,
    effects: [...colors, ...effects] as SessionEffect[],
  });

  const canvas = document.createElement("canvas");
  const renderer = new CompositionRenderer(
    {
      mediaItems: [],
      clips: rendered.clips,
      lanes: rendered.lanes,
      effects: rendered.effects,
      bpm: 120,
      canvasWidth: SIZE,
      canvasHeight: SIZE,
    },
    { canvas, audioAnalysis: "offline" },
  );
  try {
    // 120 BPM: two quarters a second.
    await renderer.renderFrameAt(2, 1);
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is unavailable.");
    const all = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, all);
    return samples.map(([x, y]) => {
      const offset =
        ((SIZE - 1 - Math.floor(y * SIZE)) * SIZE + Math.floor(x * SIZE)) * 4;
      return [all[offset], all[offset + 1], all[offset + 2]];
    });
  } finally {
    renderer.destroy();
  }
}

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const WHITE: Rgb = [255, 255, 255];
// What the composite shows where no layer is drawn.
const BACKGROUND: Rgb = [18, 20, 28];

function expectColors(actual: Rgb[], expected: Rgb[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(
        Math.abs(actual[index][channel] - value),
        `sample ${index} channel ${channel}: ${actual[index]}`,
      ).toBeLessThanOrEqual(8);
    }
  }
}

const VERTICAL_ORDER: Effect = {
  id: "order",
  trackId: "__group_main",
  effectName: "Order",
  enabled: true,
  parameters: [
    { key: "Arrangement", value: "Vertical" },
    { key: "GridSize", value: "2", numericValue: 2 },
    { key: "Spacing", value: "0", numericValue: 0 },
    { key: "ExcludedLayers", value: "" },
  ],
};

const TOP: [number, number] = [0.5, 0.2];
const BOTTOM: [number, number] = [0.5, 0.8];
const CENTER: [number, number] = [0.5, 0.5];
const CORNER: [number, number] = [0.05, 0.05];

describe("CompositionRenderer with hidden layers", () => {
  test("a hidden layer takes no Order slot and draws nothing", async () => {
    const layers = [{ fill: "rgba(255,0,0,1)" }, { fill: "rgba(0,0,255,1)" }];
    expectColors(
      await render({
        layers,
        effects: [VERTICAL_ORDER],
        samples: [TOP, BOTTOM],
      }),
      [RED, BLUE],
    );
    // With Layer 1 hidden, Layer 2 has the whole canvas to itself.
    expectColors(
      await render({
        layers: [{ ...layers[0], hidden: true }, layers[1]],
        effects: [VERTICAL_ORDER],
        samples: [TOP, BOTTOM],
      }),
      [BLUE, BLUE],
    );
  });

  test("a hidden Shape layer masks another layer without drawing itself", async () => {
    // Layer 1 is a red fill hidden inside Layer 2's oval, a white fill
    // shaped to an oval spanning the canvas: the middle shows what is
    // beneath Layer 1, and the corners, outside the oval, show Layer 1.
    const effects: Effect[] = [
      {
        id: "mask-1",
        trackId: "1",
        effectName: "Mask",
        enabled: true,
        parameters: [
          { key: "Target", value: "2" },
          { key: "Mode", value: "Subtractive" },
        ],
      },
      {
        id: "shape-2",
        trackId: "2",
        effectName: "Shape",
        enabled: true,
        parameters: [{ key: "Shape", value: "Oval" }],
      },
    ];
    const shape = { fill: "rgba(255,255,255,1)" };
    // Shown, the oval itself fills the middle.
    expectColors(
      await render({
        layers: [{ fill: "rgba(255,0,0,1)" }, shape],
        effects,
        samples: [CENTER, CORNER],
      }),
      [WHITE, RED],
    );
    // Hidden, the oval still masks Layer 1, but nothing is drawn there.
    expectColors(
      await render({
        layers: [{ fill: "rgba(255,0,0,1)" }, { ...shape, hidden: true }],
        effects,
        samples: [CENTER, CORNER],
      }),
      [BACKGROUND, RED],
    );
  });
});
