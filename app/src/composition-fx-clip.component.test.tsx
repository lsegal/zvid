import { describe, expect, test } from "vitest";
import {
  BLACK,
  BLUE,
  CYAN,
  effect,
  expectColors,
  GREEN,
  RED,
  renderOrder,
  renderScene,
  type Samples,
  sampleColors,
  sceneClip,
  solidColor,
  WHITE,
  YELLOW,
} from "./component-test/fx-clip.tsx";
import type { SessionEffect } from "./fx-stack";
import "./composition-fx-clip.ts";

// FX clips are adjustment clips: they draw nothing, and their own clip stack
// runs on everything composited beneath them, for their time range and
// within their box. An Order on one arranges every layer beneath it instead
// of the Global Order. The compositor the preview and the export share is
// driven in real WebGL and sampled.

type AdjustmentScenario = {
  // Whether Layer 2 has an FX clip, over 0-2 s.
  fxClip: boolean;
  // Effects added to the fills' red and blue Color effects.
  effects: SessionEffect[];
  playheadSeconds: number;
};

// Layer 1 is a red fill over the top half of the canvas, Layer 3 a blue
// fill over the whole canvas, both 0-4 s. With `fxClip`, Layer 2 has an FX
// clip "fx-2" over 0-2 s. Returns the 100×100 frame.
function renderAdjustment({
  fxClip,
  effects,
  playheadSeconds,
}: AdjustmentScenario) {
  const topHalf = effect("transform-1", "1", "Transform", {
    ScaleY: 0.5,
    PositionY: -0.25,
  });
  return renderScene(
    3,
    [
      sceneClip("fill-1", "fill", "1", 0, 4),
      sceneClip("fill-3", "fill", "3", 0, 4),
      ...(fxClip ? [sceneClip("fx-2", "fx", "2", 0, 2)] : []),
    ],
    [
      solidColor("color-1", "1", "#ff0000"),
      solidColor("color-3", "3", "#0000ff"),
      topHalf,
      ...effects,
    ],
    playheadSeconds,
    100,
  );
}

// Inverts every color: red becomes cyan and blue yellow.
const invert = effect("invert", "clip:fx-2", "NegativeSplit", {
  _LowIntensity: 1,
  _HighIntensity: 1,
});

// The top left (Layer 1 over Layer 3), and the bottom left and right
// (Layer 3 alone).
const SAMPLES: Samples = [
  [0.25, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

describe("FX clip compositing", { timeout: 60_000 }, () => {
  test("an FX clip without effects changes nothing", async () => {
    const base = { effects: [], playheadSeconds: 1 };
    const without = await renderAdjustment({ ...base, fxClip: false });
    const withEmpty = await renderAdjustment({ ...base, fxClip: true });
    expect(Array.from(withEmpty.pixels)).toEqual(Array.from(without.pixels));
  });

  test("adjusts the layers beneath it only during its range", async () => {
    const during = await renderAdjustment({
      fxClip: true,
      effects: [invert],
      playheadSeconds: 1,
    });
    // Layer 1 is above the FX clip on Layer 2, so it stays red; Layer 3
    // beneath it is inverted.
    expectColors(sampleColors(during, SAMPLES), [RED, YELLOW, YELLOW]);

    const after = await renderAdjustment({
      fxClip: true,
      effects: [invert],
      playheadSeconds: 3,
    });
    expectColors(sampleColors(after, SAMPLES), [RED, BLUE, BLUE]);
  });

  test("limits the adjustment to its Transform box", async () => {
    const leftHalf = effect("box", "clip:fx-2", "Transform", {
      ScaleX: 0.5,
      PositionX: -0.25,
    });
    const frame = await renderAdjustment({
      fxClip: true,
      effects: [invert, leftHalf],
      playheadSeconds: 1,
    });
    expectColors(sampleColors(frame, SAMPLES), [RED, YELLOW, BLUE]);
  });

  test("takes no Order slot", async () => {
    const order = effect("order", "__group_main", "Order", {
      Arrangement: "Vertical",
      GridSize: 2,
      Spacing: 0,
    });
    // A later identity Transform on Layer 1 wins, so each fill covers its
    // band.
    const fullBand = effect("transform-1b", "1", "Transform", {});
    const frame = await renderAdjustment({
      fxClip: true,
      effects: [invert, order, fullBand],
      playheadSeconds: 1,
    });
    // Two bands, Layer 1 on top and Layer 3 below, as without the FX clip;
    // only Layer 3 is beneath it.
    expectColors(sampleColors(frame, SAMPLES), [RED, YELLOW, YELLOW]);
  });
});

function order(trackId: string, arrangement: string) {
  return effect(`order-${trackId}`, trackId, "Order", {
    Arrangement: arrangement,
    GridSize: 2,
    Spacing: 0,
  });
}

// Cell centers of a 2×2 grid, and of four Vertical bands.
const QUADRANTS: Samples = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];
const BANDS: Samples = [
  [0.5, 0.125],
  [0.5, 0.375],
  [0.5, 0.625],
  [0.5, 0.875],
];
const FOUR_FILLS = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];

describe("FX clip Order compositing", { timeout: 60_000 }, () => {
  test("a Grid on an FX clip arranges the layers beneath it only during its range", async () => {
    const scenario = {
      layers: ["fx", ...FOUR_FILLS],
      effects: [order("clip:fx-1", "Grid")],
    };
    const during = await renderOrder({
      ...scenario,
      playheadSeconds: 1,
      samples: QUADRANTS,
    });
    expectColors(during, [RED, GREEN, BLUE, YELLOW]);

    // Once the FX clip ends the Global Vertical arranges them again.
    const after = await renderOrder({
      ...scenario,
      playheadSeconds: 3,
      samples: BANDS,
    });
    expectColors(after, [RED, GREEN, BLUE, YELLOW]);
  });

  test("leaves the layers above the FX clip where the Global Order puts them", async () => {
    const pixels = await renderOrder({
      layers: ["#ffffff", "fx", "#ff0000", "#0000ff"],
      effects: [order("clip:fx-2", "Horizontal")],
      playheadSeconds: 1,
      samples: [
        [0.5, 0.15],
        [0.25, 0.8],
        [0.75, 0.8],
      ],
    });
    // Layer 1 keeps the top of three bands; beneath it Layers 3 and 4 are
    // two columns across the FX clip's box, the whole canvas.
    expectColors(pixels, [WHITE, RED, BLUE]);
  });

  test("nested FX clips each govern the layers below them", async () => {
    const pixels = await renderOrder({
      layers: ["fx", "#ff0000", "fx", "#00ff00", "#0000ff"],
      effects: [order("clip:fx-1", "Horizontal"), order("clip:fx-3", "Grid")],
      playheadSeconds: 1,
      samples: [
        [0.15, 0.5],
        [0.4, 0.25],
        [0.75, 0.25],
        [0.75, 0.75],
      ],
    });
    // Layer 1's Horizontal gives Layer 2 the first of three columns; Layer
    // 3's Grid puts Layers 4 and 5 in the top row of the whole box beneath,
    // its empty cells in its border color.
    expectColors(pixels, [RED, GREEN, BLUE, BLACK]);
  });

  test("confines the arrangement to the FX clip's Transform box", async () => {
    const pixels = await renderOrder({
      layers: ["fx", "#ff0000", "#0000ff"],
      effects: [
        order("clip:fx-1", "Horizontal"),
        effect("box", "clip:fx-1", "Transform", { ScaleX: 0.5, ScaleY: 0.5 }),
      ],
      playheadSeconds: 1,
      samples: [
        [0.35, 0.5],
        [0.65, 0.5],
        [0.1, 0.5],
        [0.5, 0.1],
      ],
    });
    // Two columns inside the centered half-size box, nothing outside it but
    // the Global Order's border.
    expectColors(pixels, [RED, BLUE, BLACK, BLACK]);
  });

  test("runs the FX clip's other effects on the arranged result", async () => {
    const invertFirst = effect("invert", "clip:fx-1", "NegativeSplit", {
      _LowIntensity: 1,
      _HighIntensity: 1,
    });
    // Order after the inverting effect still arranges first.
    const pixels = await renderOrder({
      layers: ["fx", ...FOUR_FILLS],
      effects: [invertFirst, order("clip:fx-1", "Grid")],
      playheadSeconds: 1,
      samples: QUADRANTS,
    });
    expectColors(pixels, [CYAN, [255, 0, 255], YELLOW, BLUE]);
  });

  test("arranges the same at any output size", async () => {
    const scenario = {
      layers: ["#ffffff", "fx", "#ff0000", "#0000ff"],
      effects: [
        order("clip:fx-2", "Grid"),
        effect("box", "clip:fx-2", "Transform", {
          ScaleX: 0.5,
          PositionX: 0.25,
        }),
      ],
      playheadSeconds: 1,
      // The top row of the grid in the right half, below Layer 1's band;
      // left of the box; Layer 1's band.
      samples: [
        [0.6, 0.4],
        [0.9, 0.4],
        [0.2, 0.4],
        [0.5, 0.1],
      ] as Samples,
    };
    const preview = await renderOrder({ ...scenario, size: 90 });
    const exported = await renderOrder({ ...scenario, size: 360 });
    expectColors(preview, [RED, BLUE, BLACK, WHITE]);
    expectColors(exported, preview);
  });
});
