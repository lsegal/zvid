import { describe, test } from "vitest";
import {
  BLUE,
  expectColors,
  GREEN,
  RED,
  renderScene,
  type Samples,
  sampleColors,
  sceneClip,
  solidColor,
  YELLOW,
} from "./component-test/fx-clip.tsx";
import type { SessionEffect } from "./fx-stack";
import "./composition-transition.ts";

// A Transition on an FX clip blends from the comp beneath the clip at its
// start to the comp at its end, an Order's arranged layers counting as one
// comp. The compositor the preview and the export share is driven in real
// WebGL and sampled.

type Fill = {
  layer: number;
  color: string;
  start: number;
  end: number;
};

const parameters = (values: Record<string, string>) =>
  Object.entries(values).map(([key, value]) => ({ key, value }));

// Renders, at `playheadSeconds`, a Transition FX clip on Layer 1 over 1-3 s
// (Push Left, spanning the clip, linear), an FX clip Order on Layer 2
// arranging the layers beneath it in columns over 0-2 s, and `fills`, on
// five layers at 120×120, then returns the colors at `samples`, fractions
// of the canvas from its top-left corner.
async function renderTransition(
  fills: Fill[],
  playheadSeconds: number,
  samples: Samples,
) {
  const effects: SessionEffect[] = [
    {
      id: "transition-effect",
      trackId: "clip:transition",
      effectName: "Transition",
      enabled: true,
      parameters: parameters({ Type: "Push", Direction: "Left" }),
      animation: {
        enabled: true,
        mode: "clip",
        clip: { motionIn: "Linear", motionOut: "Linear", timing: "Full" },
      },
    } as SessionEffect,
    {
      id: "order-effect",
      trackId: "clip:order",
      effectName: "Order",
      enabled: true,
      parameters: parameters({ Arrangement: "Horizontal", Spacing: "0" }),
    },
    ...fills.map((fill, index) =>
      solidColor(`color-${index}`, `clip:fill-${index}`, fill.color),
    ),
  ];
  const frame = await renderScene(
    5,
    [
      sceneClip("transition", "fx", "1", 1, 3),
      sceneClip("order", "fx", "2", 0, 2),
      ...fills.map((fill, index) =>
        sceneClip(
          `fill-${index}`,
          "fill",
          `${fill.layer}`,
          fill.start,
          fill.end,
        ),
      ),
    ],
    effects,
    playheadSeconds,
    120,
  );
  return sampleColors(frame, samples);
}

// The Order arranges red, green and blue on Layers 3-5 until the cut at
// 2 s, when yellow comes in on Layer 3 alone.
const ORDER_THEN_NEXT: Fill[] = [
  { layer: 3, color: "#ff0000", start: 0, end: 2 },
  { layer: 4, color: "#00ff00", start: 0, end: 2 },
  { layer: 5, color: "#0000ff", start: 0, end: 2 },
  { layer: 3, color: "#ffff00", start: 2, end: 4 },
];
const ACROSS: Samples = [
  [0.05, 0.5],
  [0.25, 0.5],
  [0.45, 0.5],
  [0.55, 0.5],
  [0.95, 0.5],
];

describe("Transition compositing", { timeout: 60_000 }, () => {
  test("starts on the Order's arranged group", async () => {
    expectColors(await renderTransition(ORDER_THEN_NEXT, 1, ACROSS), [
      RED,
      RED,
      GREEN,
      GREEN,
      BLUE,
    ]);
  });

  test("pushes the arranged group off as one picture across the cut", async () => {
    // Halfway, the group's right half (the end of green, then blue) fills
    // the left half, and yellow fills the right.
    expectColors(await renderTransition(ORDER_THEN_NEXT, 2, ACROSS), [
      GREEN,
      BLUE,
      BLUE,
      YELLOW,
      YELLOW,
    ]);
    // Before the cut the next clip is held on its first frame.
    const beforeCut = await renderTransition(ORDER_THEN_NEXT, 1.9, [
      [0.95, 0.5],
    ]);
    expectColors(beforeCut, [YELLOW]);
  });

  test("ends on the next clip alone", async () => {
    expectColors(await renderTransition(ORDER_THEN_NEXT, 2.99, ACROSS), [
      YELLOW,
      YELLOW,
      YELLOW,
      YELLOW,
      YELLOW,
    ]);
  });
});
