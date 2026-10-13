import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { addFromMenu, devicesIn } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import { renderFrame } from "../../../component-test/fx-render.ts";
import {
  colorEffect,
  pixelAtFraction,
  type Rgba,
  syntheticClip,
  syntheticLanes,
  syntheticState,
} from "../../../component-test/fx-scenes.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import type { SessionEffect } from "../../../fx-stack";
import "./pass.ts";
import { SHAPE_EFFECT_NAME } from "./shape.ts";

// Shape (#1006): a layer draws only inside a shape stretched over its box.
// Added from a layer's Video → Transform menu with a centered square
// Transform, its shape picked from a popout of black-on-white previews, and
// rendered in real WebGL on a small synthetic frame.

// The layer's devices labeled `name`.
const layerDevices = (name: string) =>
  devicesIn("layer").filter(
    (element) => element.getAttribute("aria-label") === name,
  );
const shapeDevice = () => page.elementLocator(layerDevices("Shape")[0]);
const transformDevice = () => page.elementLocator(layerDevices("Transform")[0]);

describe("Shape", { timeout: 60_000 }, () => {
  test("is added with a centered square Transform and picks its shape from a popout of previews", async () => {
    await render(
      <FxEditor
        project={
          withFillClip(EMPTY_PROJECT, getDefaultFillColor(undefined)).project
        }
        selection={{ laneId: "1" }}
      />,
    );
    expect(layerDevices("Transform")).toHaveLength(0);

    await addFromMenu(
      "Add device to this layer",
      "Transform",
      "Shape",
      "Video",
    );
    await expect.poll(() => layerDevices("Shape").length).toBe(1);
    // The layer had no Transform, so one is added: a square half the canvas
    // height across, centered.
    expect(layerDevices("Transform")).toHaveLength(1);
    for (const [label, text] of [
      ["X", "0%"],
      ["Y", "0%"],
      ["Height", "50%"],
      ["Rotation", "0°"],
    ]) {
      await expect
        .element(
          transformDevice().getByRole("slider", { name: label, exact: true }),
        )
        .toHaveAttribute("aria-valuetext", text);
    }
    // Its outline's knobs, which can be animated, start as a fill.
    for (const [label, text] of [
      ["Stroke", "0 px"],
      ["Dash", "0 px"],
      ["Gap", "20 px"],
      ["Offset", "0 px"],
      ["Drawn", "100%"],
    ]) {
      await expect
        .element(
          shapeDevice().getByRole("slider", { name: label, exact: true }),
        )
        .toHaveAttribute("aria-valuetext", text);
    }
    expect(
      shapeDevice()
        .getByRole("button", { name: /Animation/ })
        .elements().length,
    ).toBeGreaterThan(0);

    const trigger = () =>
      shapeDevice().getByRole("button", { name: /^Shape: / });
    await expect.element(trigger()).toHaveAccessibleName("Shape: Rectangle");
    for (const name of ["Oval", "Star", "Arrow", "Rectangle"]) {
      await userEvent.click(trigger());
      const listbox = page.getByRole("listbox");
      await expect.element(listbox).toBeVisible();
      const options = listbox.getByRole("option");
      expect(options.elements()).toHaveLength(5);
      // Every option is a black-on-white preview of its shape; Custom shows
      // its SVG once it has one.
      expect(
        options
          .elements()
          .flatMap((option) => [...option.querySelectorAll("svg path")]),
      ).toHaveLength(4);
      await userEvent.click(options.filter({ hasText: name }));
      await expect.poll(() => listbox.elements().length).toBe(0);
      await expect.element(trigger()).toHaveAccessibleName(`Shape: ${name}`);
    }

    // Adding a second Shape leaves the Transform as it is.
    await addFromMenu(
      "Add device to this layer",
      "Transform",
      "Shape",
      "Video",
    );
    await expect.poll(() => layerDevices("Shape").length).toBe(2);
    expect(layerDevices("Transform")).toHaveLength(1);
  });
});

const WIDTH = 200;
const HEIGHT = 100;

// A WIDTH×HEIGHT frame of one white fill clip on Layer 1, filling the
// canvas, with a Shape of `shape` on the layer and, when given, a
// Transform. Returns the RGBA of each point, in fractions of the frame from
// its top-left corner.
async function renderPoints(
  shape: string,
  points: Array<[number, number]>,
  transform?: Record<string, number>,
  outline: Record<string, number> = {},
) {
  const effects: SessionEffect[] = [
    colorEffect("1", "rgba(255,255,255,1)"),
    {
      id: "shape-1",
      trackId: "1",
      effectName: SHAPE_EFFECT_NAME,
      enabled: true,
      parameters: [
        { key: "Shape", value: shape },
        ...Object.entries(outline).map(([key, value]) => ({
          key,
          value: String(value),
          numericValue: value,
        })),
      ],
    },
  ];
  if (transform) {
    effects.push({
      id: "transform-1",
      trackId: "1",
      effectName: "Transform",
      enabled: true,
      parameters: Object.entries(transform).map(([key, value]) => ({
        key,
        value: String(value),
        numericValue: value,
      })),
    });
  }
  const frame = await renderFrame(
    syntheticState(WIDTH, HEIGHT, {
      clips: [syntheticClip("1")],
      lanes: syntheticLanes(1),
      effects,
    }),
    1,
    0.5,
  );
  return points.map(([x, y]) => pixelAtFraction(frame, x, y));
}

const isWhite = ([red]: Rgba) => red > 230;
const isDark = ([red]: Rgba) => red < 25;

describe("Shape rendering", { timeout: 60_000 }, () => {
  // Points inside and outside each shape, stretched over the whole frame.
  const CASES: Array<
    [string, Array<[number, number]>, Array<[number, number]>]
  > = [
    [
      "Rectangle",
      [
        [0.5, 0.5],
        [0.01, 0.02],
        [0.99, 0.98],
      ],
      [],
    ],
    [
      "Oval",
      [
        [0.5, 0.5],
        [0.03, 0.5],
        [0.5, 0.05],
      ],
      [
        [0.05, 0.08],
        [0.95, 0.92],
      ],
    ],
    [
      "Star",
      [
        [0.5, 0.5],
        [0.5, 0.1],
      ],
      [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.95],
      ],
    ],
    [
      "Arrow",
      [
        [0.1, 0.5],
        [0.95, 0.5],
        [0.62, 0.1],
      ],
      [
        [0.1, 0.1],
        [0.1, 0.9],
        [0.95, 0.15],
      ],
    ],
  ];
  for (const [shape, inside, outside] of CASES) {
    test(`${shape} keeps the layer inside it and clears it outside`, async () => {
      const pixels = await renderPoints(shape, [...inside, ...outside]);
      inside.forEach((point, index) => {
        expect(isWhite(pixels[index]), `${point} inside`).toBe(true);
      });
      outside.forEach((point, index) => {
        expect(isDark(pixels[inside.length + index]), `${point} outside`).toBe(
          true,
        );
      });
    });
  }

  test("follows its Transform's box", async () => {
    // An Oval in the right half of the frame: its box spans x 0.5..1.
    const [center, leftOfBox, boxCorner] = await renderPoints(
      "Oval",
      [
        [0.75, 0.5],
        [0.3, 0.5],
        [0.52, 0.05],
      ],
      { ScaleX: 0.5, PositionX: 0.25 },
    );
    expect(isWhite(center)).toBe(true);
    expect(isDark(leftOfBox)).toBe(true);
    expect(isDark(boxCorner)).toBe(true);
  });

  test("antialiases its edge", async () => {
    // A row crossing an Oval's curved edge has partly covered pixels.
    const row = await renderPoints(
      "Oval",
      Array.from({ length: WIDTH }, (_, index) => [(index + 0.5) / WIDTH, 0.2]),
    );
    expect(row.some((pixel) => pixel[0] > 25 && pixel[0] < 230)).toBe(true);
  });
});

// A circle 100 px across in the frame's right half: an Oval whose 200×100
// box its Transform squeezes to a square. Its outline's lengths are in
// output pixels at 1080p, so 108 is 10 px on this 100 px tall frame.
const CIRCLE = { ScaleX: 0.5, PositionX: 0.25 };
const px = (pixels: number) => (pixels * 1080) / HEIGHT;
const CIRCLE_TOP: [number, number] = [0.75, 0.04];
const CIRCLE_RIGHT: [number, number] = [0.98, 0.5];
const CIRCLE_BOTTOM: [number, number] = [0.75, 0.96];
const CIRCLE_LEFT: [number, number] = [0.52, 0.5];
const CIRCLE_CENTER: [number, number] = [0.75, 0.5];

describe("Shape outlines", { timeout: 60_000 }, () => {
  test("draws a Stroke wide band inside the edge, evenly once transformed", async () => {
    const [top, right, bottom, left, center, nearTop] = await renderPoints(
      "Oval",
      [
        CIRCLE_TOP,
        CIRCLE_RIGHT,
        CIRCLE_BOTTOM,
        CIRCLE_LEFT,
        CIRCLE_CENTER,
        [0.75, 0.2],
      ],
      CIRCLE,
      { StrokeWidth: px(10) },
    );
    for (const pixel of [top, right, bottom, left]) {
      expect(isWhite(pixel)).toBe(true);
    }
    expect(isDark(center)).toBe(true);
    expect(isDark(nearTop)).toBe(true);
  });

  test("dashes the outline, and its Offset marches the dashes", async () => {
    // Dashes and gaps 30 px long start at the top: the top is in a dash.
    const dashed = { StrokeWidth: px(10), DashLength: px(30), DashGap: px(30) };
    const row = Array.from({ length: 101 }, (_, index): [number, number] => [
      0.5 + index / 200,
      0.04,
    ]);
    const [top, ...across] = await renderPoints(
      "Oval",
      [CIRCLE_TOP, ...row],
      CIRCLE,
      dashed,
    );
    expect(isWhite(top)).toBe(true);
    // The band runs along the circle's top: some of it dashes, some gaps.
    const band = across.filter((_, index) => Math.abs(index - 50) < 30);
    expect(band.some(isWhite)).toBe(true);
    expect(band.some(isDark)).toBe(true);
    // Moved by half a period, a gap sits at the top instead.
    const [marched] = await renderPoints("Oval", [CIRCLE_TOP], CIRCLE, {
      ...dashed,
      DashOffset: px(30),
    });
    expect(isDark(marched)).toBe(true);
  });

  test("draws only Drawn of the outline, clockwise from the top", async () => {
    const [top, right, left] = await renderPoints(
      "Oval",
      [
        [0.77, 0.04],
        CIRCLE_RIGHT,
        CIRCLE_LEFT,
      ],
      CIRCLE,
      { StrokeWidth: px(10), StrokeDrawn: 0.5 },
    );
    expect(isWhite(top)).toBe(true);
    expect(isWhite(right)).toBe(true);
    expect(isDark(left)).toBe(true);
  });
});
