import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { patchProjectState } from "../../../app/session-project.ts";
import type { Lane, ProjectState } from "../../../app/types.ts";
import { addFromMenu, device } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import { EMPTY_PROJECT } from "../../../component-test/fx-projects.ts";
import { renderFrame } from "../../../component-test/fx-render.ts";
import {
  colorEffect,
  pixelAtFraction,
  type Rgba,
  syntheticClip,
  syntheticLanes,
  syntheticState,
} from "../../../component-test/fx-scenes.ts";
import type { SessionEffect } from "../../../fx-stack";
import { createLaneId, getNextLaneName, insertLane } from "../../../lanes.ts";
import { MASK_EFFECT_NAME } from "./mask.ts";

// A Mask shows its layer only where its Target layer draws (Additive), or
// everywhere but there (Subtractive), by the Target's drawn pixels rather
// than its box: a fill masked by a text layer shows, or loses, the shape of
// the letters. The compositor the preview and the export share is driven in
// real WebGL and sampled.

type Rgb = [number, number, number];

// A layer's one clip, 0-4 s: a fill of a color or gradient, on a hidden
// layer when `hidden`, a text clip, an FX clip, or none.
type LayerContent =
  | { fill: string; hidden?: boolean }
  | { text: string; color: string }
  | "fx"
  | null;

type Scenario = {
  // Layers, from Layer 1 down.
  layers: LayerContent[];
  effects: SessionEffect[];
  samples: Array<[number, number]>;
};

const SIZE = 120;

function textEffect(trackId: string, text: string, color: string) {
  return {
    id: `text-${trackId}`,
    trackId,
    effectName: "Text",
    enabled: true,
    parameters: [
      { key: "Text", value: text },
      { key: "FontFamily", value: "Inter" },
      { key: "FontWeight", value: "Bold" },
      { key: "FontSize", value: "900", numericValue: 900 },
      { key: "Align", value: "Center" },
      { key: "VerticalAlign", value: "Middle" },
      { key: "FillMode", value: "Solid" },
      { key: "Color", value: color },
    ],
  };
}

// Renders the layers at 1 s and returns the pixels at `samples`, fractions
// of the canvas from its top-left corner.
async function renderScenario({ layers, effects, samples }: Scenario) {
  const clips = layers.flatMap((layer, index) => {
    if (!layer) return [];
    const laneId = `${index + 1}`;
    const kind = layer === "fx" ? "fx" : "fill" in layer ? "fill" : "text";
    return [
      syntheticClip(
        laneId,
        kind,
        layer !== "fx" && "hidden" in layer && layer.hidden
          ? { hidden: true }
          : {},
      ),
    ];
  });
  const content = layers.flatMap((layer, index) => {
    if (!layer || layer === "fx") return [];
    const trackId = `${index + 1}`;
    return [
      "fill" in layer
        ? colorEffect(trackId, layer.fill)
        : textEffect(trackId, layer.text, layer.color),
    ];
  });
  // 120 BPM: two quarters a second.
  const frame = await renderFrame(
    syntheticState(SIZE, SIZE, {
      clips,
      lanes: syntheticLanes(layers.length),
      effects: [...content, ...effects],
    }),
    2,
    1,
  );
  return samples.map(
    ([x, y]) => pixelAtFraction(frame, x, y).slice(0, 3) as Rgb,
  );
}

function mask(trackId: string, target: string, mode: string): SessionEffect {
  return {
    id: `mask-${trackId}`,
    trackId,
    effectName: MASK_EFFECT_NAME,
    enabled: true,
    parameters: [
      { key: "Target", value: target },
      { key: "Mode", value: mode },
    ],
  };
}

// An Order on the FX clip on Layer `laneId`, arranging the layers beneath
// it.
function order(laneId: string): SessionEffect {
  return {
    id: `order-${laneId}`,
    trackId: `clip:fx-${laneId}`,
    effectName: "Order",
    enabled: true,
    parameters: [
      { key: "Arrangement", value: "Vertical" },
      { key: "GridSize", value: "2", numericValue: 2 },
      { key: "Spacing", value: "0", numericValue: 0 },
    ],
  };
}

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
// What the composite shows where no layer is drawn.
const BACKGROUND: Rgb = [18, 20, 28];

function expectColors(actual: Rgba[], expected: Rgb[]) {
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

// Layer 1 is a red fill, Layer 2 a blue "I" filling the canvas's height.
// The middle of the canvas is inside the letter's stem; left of it is inside
// the text's box, which spans the canvas, but no letter is drawn there.
const LAYERS: LayerContent[] = [
  { fill: "rgba(255,0,0,1)" },
  { text: "I", color: "rgba(0,0,255,1)" },
];
const IN_LETTER: [number, number] = [0.5, 0.5];
const OUTSIDE_LETTER: [number, number] = [0.12, 0.5];

describe("Mask rendering", { timeout: 60_000 }, () => {
  test("draws both layers as usual without a Mask", async () => {
    // The red fill on top covers the letter.
    expectColors(
      await renderScenario({
        layers: LAYERS,
        effects: [],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      [RED, RED],
    );
  });

  test("shows a fill only inside the letters of an Additive Target", async () => {
    expectColors(
      await renderScenario({
        layers: LAYERS,
        effects: [mask("1", "2", "Additive")],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      // Outside the letter nothing is drawn, though the text's box is there.
      [RED, BACKGROUND],
    );
  });

  test("cuts the letters of a Subtractive Target out of a fill", async () => {
    expectColors(
      await renderScenario({
        layers: LAYERS,
        effects: [mask("1", "2", "Subtractive")],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      // The Target keeps drawing, so its letter shows through the cut.
      [BLUE, RED],
    );
  });

  test("a Target with no active clip hides an Additive layer and leaves a Subtractive one", async () => {
    const layers: LayerContent[] = [{ fill: "rgba(255,0,0,1)" }, null];
    expectColors(
      await renderScenario({
        layers,
        effects: [mask("1", "2", "Additive")],
        samples: [IN_LETTER],
      }),
      [BACKGROUND],
    );
    expectColors(
      await renderScenario({
        layers,
        effects: [mask("1", "2", "Subtractive")],
        samples: [IN_LETTER],
      }),
      [RED],
    );
  });
});

// An FX clip's Order draws the layers beneath it into its own box, so a
// Mask and its Target can be drawn on different surfaces: the Target's
// pixels are taken from where they end up on the canvas.
describe("a Mask Target across an FX clip's Order", { timeout: 60_000 }, () => {
  // Layer 2 is an FX clip arranging Layers 3 and 4 in Vertical bands, Layer
  // 3 in the top one.
  const TOP: [number, number] = [0.5, 0.25];
  const BOTTOM: [number, number] = [0.5, 0.75];

  test("masks a layer above the arrangement by a Target inside it", async () => {
    expectColors(
      await renderScenario({
        layers: [
          { fill: "rgba(255,0,0,1)" },
          "fx",
          { fill: "rgba(0,0,255,1)" },
          { fill: "rgba(0,255,0,1)" },
        ],
        effects: [order("2"), mask("1", "3", "Additive")],
        samples: [TOP, BOTTOM],
      }),
      // The red fill shows only over Layer 3's band.
      [RED, GREEN],
    );
  });

  test("masks a layer inside the arrangement by a Target above it", async () => {
    // Layer 1, a half-transparent blue "I", is drawn on the canvas over the
    // arrangement, where Layer 3, a red fill in the top band, is cut by its
    // letter. Where it is cut, only the letter's blue shows over the
    // Order's black border.
    const layers: LayerContent[] = [
      { text: "I", color: "rgba(0,0,255,0.5)" },
      "fx",
      { fill: "rgba(255,0,0,1)" },
      { fill: "rgba(0,255,0,1)" },
    ];
    // In the top band, where the letter's stem begins and left of it.
    const samples: Array<[number, number]> = [
      [0.5, 0.35],
      [0.12, 0.35],
    ];
    const [cut, outside] = await renderScenario({
      layers,
      effects: [order("2"), mask("3", "1", "Subtractive")],
      samples,
    });
    const [unmasked] = await renderScenario({
      layers,
      effects: [order("2")],
      samples,
    });
    expectColors([outside], [RED]);
    // Unmasked, the letter's blue shows the red beneath it.
    expect(unmasked[0] - cut[0]).toBeGreaterThan(48);
  });
});

// A masked Target contributes its masked pixels to the layer it masks.
describe("chained masks", { timeout: 60_000 }, () => {
  // Layer 1 is a red fill masked by Layer 2, a blue "I" that Layer 3, a
  // green fill, cuts away.
  test("masks by a Target's masked pixels", async () => {
    const layers: LayerContent[] = [
      { fill: "rgba(255,0,0,1)" },
      { text: "I", color: "rgba(0,0,255,1)" },
      { fill: "rgba(0,255,0,1)" },
    ];
    expectColors(
      await renderScenario({
        layers,
        effects: [mask("1", "2", "Additive"), mask("2", "3", "Subtractive")],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      // Layer 2 is cut away entirely by Layer 3's fill, so Layer 1 shows
      // nowhere and Layer 3's green shows through.
      [GREEN, GREEN],
    );
  });

  test("draws a cycle of masks without recursing forever", async () => {
    // Each layer closing the cycle is drawn unmasked, so each is masked by
    // the other's own pixels.
    expectColors(
      await renderScenario({
        layers: LAYERS,
        effects: [mask("1", "2", "Additive"), mask("2", "1", "Additive")],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      [RED, BACKGROUND],
    );
  });
});

// On an FX clip, a Mask limits where the clip's effects apply: a Pixelate
// FX clip masked by an Oval pixelates only inside it (Additive), or only
// outside it (Subtractive).
describe("a Mask on an FX clip", { timeout: 60_000 }, () => {
  // Layer 1 is the FX clip, Layer 2 a hidden fill shaped to an oval
  // spanning the canvas, and Layer 3 a black-to-white gradient across it.
  const layers: LayerContent[] = [
    "fx",
    { fill: "rgba(255,255,255,1)", hidden: true },
    {
      fill: "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(255,255,255,1) 100%)",
    },
  ];
  const effects: SessionEffect[] = [
    {
      id: "shape-2",
      trackId: "2",
      effectName: "Shape",
      enabled: true,
      parameters: [{ key: "Shape", value: "Oval" }],
    },
    {
      id: "pixelate-1",
      trackId: "clip:fx-1",
      effectName: "Pixelate",
      enabled: true,
      // Blocks an eighth of the canvas across: 15 px.
      parameters: [{ key: "_NumPixels", value: "1", numericValue: 1 }],
    },
  ];
  // Two points 11 px apart in one block, in the middle of the oval and in
  // its top-left corner, outside it. Unpixelated, the gradient differs
  // between them; pixelated, they are the same block.
  const samples: Array<[number, number]> = [
    [61.5 / SIZE, 0.5],
    [72.5 / SIZE, 0.5],
    [1.5 / SIZE, 0.05],
    [12.5 / SIZE, 0.05],
  ];
  // Whether the middle and the corner are pixelated.
  async function pixelated(mode?: string) {
    const [a, b, c, d] = await renderScenario({
      layers,
      effects: mode ? [...effects, mask("clip:fx-1", "2", mode)] : effects,
      samples,
    });
    const flat = (left: Rgba, right: Rgba) => Math.abs(left[0] - right[0]) <= 2;
    // Unpixelated, the gradient rises about 2 levels a pixel.
    for (const [left, right] of [
      [a, b],
      [c, d],
    ]) {
      expect(
        flat(left, right) || right[0] - left[0] > 12,
        `${left} ${right}`,
      ).toBe(true);
    }
    return [flat(a, b), flat(c, d)];
  }

  test("pixelates everywhere without a Mask", async () => {
    expect(await pixelated()).toEqual([true, true]);
  });

  test("pixelates only inside an Additive Target", async () => {
    expect(await pixelated("Additive")).toEqual([true, false]);
  });

  test("pixelates only outside a Subtractive Target", async () => {
    expect(await pixelated("Subtractive")).toEqual([false, true]);
  });
});

// A new session's Layer 1 with Layers 2 and 3 inserted below it, as its
// header menu's Insert layer below does.
function withThreeLayers(project: ProjectState) {
  let next = project;
  for (let count = 0; count < 2; count++) {
    const lane: Lane = {
      id: createLaneId(next.lanes),
      name: getNextLaneName(next.lanes),
      colorIndex: -1,
    };
    next = patchProjectState(next, insertLane(next, next.lanes.length, lane));
  }
  return next;
}

// The Target menu offers every other layer, one at a time, and never the
// layer the Mask is on.
describe("Mask Target", { timeout: 60_000 }, () => {
  test("picks one other layer as the Target", async () => {
    const project = withThreeLayers(EMPTY_PROJECT);
    const layer = project.lanes.find((lane) => lane.id === "3");
    if (!layer) {
      throw new Error("No Layer 3");
    }
    await render(<FxEditor project={project} selection={{ laneId: "3" }} />);
    await addFromMenu("Add device to this layer", "Transform", "Mask", "Video");

    const maskDevice = () => device("Mask");
    const target = () => maskDevice().getByRole("button", { name: "Target" });
    await expect
      .poll(() => target().element().textContent)
      .toBe("Target: None");
    await userEvent.click(target());
    const options = page.getByRole("menuitemcheckbox");
    await expect.element(options.first()).toBeVisible();
    const names = options.elements().map((option) => option.textContent ?? "");
    expect(names[0]).toBe("None");
    expect(names.length).toBeGreaterThan(1);
    for (const name of names.slice(1)) {
      expect(layer.name).not.toContain(name.replace(/^\d+/, ""));
    }
    await expect
      .element(options.first())
      .toHaveAttribute("aria-checked", "true");

    const other = names[1].replace(/^\d+/, "");
    await userEvent.click(options.nth(1));
    await expect
      .poll(() => target().element().textContent)
      .toBe(`Target: ${other}`);
    await userEvent.click(target());
    await expect
      .poll(
        () =>
          page.getByRole("menuitemcheckbox", { checked: true }).elements()
            .length,
      )
      .toBe(1);
    await expect
      .element(options.nth(1))
      .toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");

    await expect
      .element(maskDevice().getByRole("button", { name: "Additive" }))
      .toHaveAttribute("aria-pressed", "true");
  });
});
