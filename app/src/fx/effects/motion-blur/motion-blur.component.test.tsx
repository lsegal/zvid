import { describe, expect, test } from "vitest";
import { type Locator, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { patchProjectState } from "../../../app/session-project.ts";
import type { ProjectState } from "../../../app/types.ts";
import {
  addFromMenu,
  device,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  fillState,
  layerEffect,
  parameters,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  withTextClip,
} from "../../../component-test/fx-projects.ts";
import {
  type Frame,
  meanChange,
  pixelAt,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import "./pass.ts";

// Motion Blur (#1305): smears what it's applied to along its Angle over its
// Distance. Added from a layer's Video → Blur menu, and rendered in real
// WebGL on small synthetic frames.

const PREVIEW = { width: 320, height: 180 };

// Types `value` into the `label` knob's readout, shown as `shown`.
async function setKnob(
  blur: Locator,
  label: string,
  value: string,
  shown: string,
) {
  await typeValue(blur, label, value);
  await expect
    .element(blur.getByRole("slider", { name: label }))
    .toHaveAttribute("aria-valuetext", shown);
}

describe("Motion Blur", { timeout: 60_000 }, () => {
  test("is added from a layer's Video → Blur menu and smears the preview more as Distance grows", async () => {
    // A text clip on layer 1, previewed in its middle.
    let project: ProjectState = withTextClip(EMPTY_PROJECT).project;
    const preview = () => renderFrame(rendererState(project, PREVIEW), 4);
    const sharp = await preview();

    await render(
      <FxEditor
        project={project}
        selection={{ laneId: "1" }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    await addFromMenu(
      "Add device to this layer",
      "Blur",
      "Motion Blur",
      "Video",
    );

    const blur = device("Motion Blur");
    await expect
      .element(blur.getByRole("slider", { name: "Angle" }))
      .toHaveAttribute("aria-valuetext", "0°");
    await expect
      .element(blur.getByRole("slider", { name: "Distance" }))
      .toHaveAttribute("aria-valuetext", "60 px");
    const animation = blur.getByRole("button", {
      name: "Turn Animation Off for Motion Blur",
    });
    await expect.element(animation).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(animation);

    // The default Distance smears the text.
    const atDefault = meanChange(await preview(), sharp);
    expect(atDefault).toBeGreaterThan(0.1);

    // A longer Distance smears it further.
    await setKnob(blur, "Distance", "240", "240 px");
    const across = await preview();
    expect(meanChange(across, sharp)).toBeGreaterThan(atDefault * 1.25);

    // Turning it smears the text down instead.
    await setKnob(blur, "Angle", "90", "90°");
    const downward = await preview();
    expect(meanChange(downward, sharp)).toBeGreaterThan(atDefault);
    expect(meanChange(downward, across)).toBeGreaterThan(0.1);

    // Distance 0 leaves the text sharp.
    await setKnob(blur, "Distance", "0", "0 px");
    expect(meanChange(await preview(), sharp)).toBeLessThan(0.02);
  });
});

// A `width`×`height` frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Motion Blur of `distance` at `angle` on the
// layer, or none when `distance` is undefined.
function renderFill(
  paint: string,
  angle: number,
  distance: number | undefined,
  width = 320,
  height = 180,
): Promise<Frame> {
  const effects =
    distance === undefined
      ? []
      : [
          layerEffect(
            "MotionBlur",
            parameters({ _Angle: angle, _Distance: distance }),
          ),
        ];
  return renderFrame(fillState(paint, effects, { width, height }), 1, 0.5);
}

// Black on one side of a hard edge through the middle and white on the
// other: down the frame (a vertical edge) or across it (a horizontal one).
const VERTICAL_EDGE =
  "linear-gradient(90deg, #000 0%, #000 50%, #fff 50%, #fff 100%)";
const HORIZONTAL_EDGE =
  "linear-gradient(180deg, #000 0%, #000 50%, #fff 50%, #fff 100%)";

// The red levels across the middle row, and down the middle column.
function across(frame: Frame) {
  return Array.from(
    { length: frame.width },
    (_, x) => pixelAt(frame, x, Math.floor(frame.height / 2))[0],
  );
}
function down(frame: Frame) {
  return Array.from(
    { length: frame.height },
    (_, y) => pixelAt(frame, Math.floor(frame.width / 2), y)[0],
  );
}

// How many pixels a run of levels takes to rise from 10% to 90%.
function spread(levels: number[]) {
  return (
    levels.findIndex((level) => level > 230) -
    levels.findIndex((level) => level > 25)
  );
}

function maxDifference(left: number[], right: number[]) {
  return Math.max(...left.map((level, i) => Math.abs(level - right[i])));
}

describe("Motion Blur rendering", { timeout: 60_000 }, () => {
  test("Distance 0 leaves the frame as it was", async () => {
    const plain = await renderFill(VERTICAL_EDGE, 0, undefined);
    const still = await renderFill(VERTICAL_EDGE, 0, 0);
    expect(Array.from(still.pixels)).toEqual(Array.from(plain.pixels));
  });

  test("at 0° a vertical edge smears evenly across, and a horizontal one stays sharp", async () => {
    // 120 px at 1080p is 20 px of this 180 px frame.
    const row = across(await renderFill(VERTICAL_EDGE, 0, 120));
    expect(spread(row)).toBeGreaterThanOrEqual(14);
    expect(spread(row)).toBeLessThanOrEqual(19);
    // An even ramp, the same on both sides of the edge.
    const middle = row.length / 2;
    for (let x = middle - 8; x < middle + 8; x++) {
      expect(row[x + 1] - row[x], `x = ${x}`).toBeGreaterThan(6);
      expect(row[x + 1] - row[x], `x = ${x}`).toBeLessThan(20);
    }
    for (let distance = 0; distance < 12; distance++) {
      expect(
        Math.abs(row[middle - 1 - distance] + row[middle + distance] - 255),
        `distance = ${distance}`,
      ).toBeLessThan(4);
    }
    // Away from the edge the halves keep their colors.
    expect(row[10]).toBe(0);
    expect(row[309]).toBe(255);

    // Nothing smears across a horizontal edge.
    const plain = down(await renderFill(HORIZONTAL_EDGE, 0, undefined));
    const smeared = down(await renderFill(HORIZONTAL_EDGE, 0, 120));
    expect(maxDifference(smeared, plain)).toBeLessThanOrEqual(2);
  });

  test("at 90° a horizontal edge smears evenly down, and a vertical one stays sharp", async () => {
    const column = down(await renderFill(HORIZONTAL_EDGE, 90, 120));
    expect(spread(column)).toBeGreaterThanOrEqual(14);
    expect(spread(column)).toBeLessThanOrEqual(19);
    const middle = column.length / 2;
    for (let y = middle - 8; y < middle + 8; y++) {
      expect(column[y + 1] - column[y], `y = ${y}`).toBeGreaterThan(6);
      expect(column[y + 1] - column[y], `y = ${y}`).toBeLessThan(20);
    }

    const plain = across(await renderFill(VERTICAL_EDGE, 90, undefined));
    const smeared = across(await renderFill(VERTICAL_EDGE, 90, 120));
    expect(maxDifference(smeared, plain)).toBeLessThanOrEqual(2);
  });

  test("transparent areas don't darken the edges they meet", async () => {
    // Red fading into transparency must cover the background just as red
    // fading into opaque black covers it with red: the black version's red
    // level is the coverage.
    const fading =
      "linear-gradient(90deg, rgba(255,0,0,1) 0%, rgba(255,0,0,1) 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0) 100%)";
    const transparent = across(await renderFill(fading, 0, 240));
    const black = across(
      await renderFill(
        "linear-gradient(90deg, rgba(255,0,0,1) 0%, rgba(255,0,0,1) 50%, rgba(0,0,0,1) 50%, rgba(0,0,0,1) 100%)",
        0,
        240,
      ),
    );
    const background = across(await renderFill(fading, 0, undefined))[319];
    for (let x = 140; x < 180; x++) {
      const coverage = black[x] / 255;
      const expected = 255 * coverage + background * (1 - coverage);
      expect(Math.abs(transparent[x] - expected), `x = ${x}`).toBeLessThan(4);
    }
  });

  test("renders the same smear at the preview's size and a larger export's", async () => {
    const small = across(await renderFill(VERTICAL_EDGE, 0, 120, 320, 180));
    const large = across(await renderFill(VERTICAL_EDGE, 0, 120, 640, 360));
    expect(Math.abs(spread(large) - 2 * spread(small))).toBeLessThanOrEqual(2);
    // Each pair of the larger frame's pixels averages to the smaller one's.
    const sampled = small.map((_, x) => (large[2 * x] + large[2 * x + 1]) / 2);
    expect(maxDifference(sampled, small)).toBeLessThanOrEqual(10);
  });
});

// A text clip on Layer 1 whose text fills its box, which the layer's
// Transform shrinks to the middle half of a 320×180 frame, with `effects`
// after the Transform.
function textPastItsBox(effects: ReturnType<typeof layerEffect>[]) {
  const { project, clip } = withTextClip(EMPTY_PROJECT);
  return rendererState(
    patchProjectState(project, {
      effects: [
        ...project.effects.map((effect) =>
          effect.trackId.includes(clip.id)
            ? {
                ...effect,
                parameters: [
                  ...effect.parameters.filter(
                    ({ key }) => key !== "Text" && key !== "FontSize",
                  ),
                  ...parameters({ Text: "MMMMMMMMMMMMMMMM", FontSize: 300 }),
                ],
              }
            : effect,
        ),
        layerEffect("Transform", parameters({ ScaleX: 0.5, ScaleY: 0.5 })),
        ...effects,
      ],
    }),
    PREVIEW,
  );
}

// The first and last columns the text lights, in any row.
function litColumns(frame: Frame) {
  let first = frame.width;
  let last = -1;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (pixelAt(frame, x, y)[0] > 16) {
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
  }
  return { first, last };
}

// The text box's first and last columns: the middle half of the frame.
const BOX_LEFT = 80;
const BOX_RIGHT = 239;

describe("Motion Blur on text", { timeout: 60_000 }, () => {
  test("a text clip's smear trails past its box instead of stopping at its edges", async () => {
    const sharp = litColumns(await renderFrame(textPastItsBox([]), 4));
    expect(sharp.first).toBeGreaterThanOrEqual(BOX_LEFT);
    expect(sharp.last).toBeLessThanOrEqual(BOX_RIGHT);

    // 400 px at 1080p is 67 px of this 180 px frame, so the smear reaches
    // about 33 px past the text on each side, well past its box.
    const blur = layerEffect(
      "MotionBlur",
      parameters({ _Angle: 0, _Distance: 400 }),
    );
    const smeared = litColumns(await renderFrame(textPastItsBox([blur]), 4));
    expect(smeared.first).toBeLessThan(BOX_LEFT - 8);
    expect(smeared.first).toBeGreaterThanOrEqual(sharp.first - 34);
    expect(smeared.last).toBeGreaterThan(BOX_RIGHT + 8);
    expect(smeared.last).toBeLessThanOrEqual(sharp.last + 34);
  });
});
