import { describe, expect, test } from "vitest";
import { type Locator, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
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
  middleRow,
  parameters,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  withTextClip,
} from "../../../component-test/fx-projects.ts";
import {
  meanChange,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import "./pass.ts";

// Gaussian Blur (#1024): blurs what it's applied to by its Radius. Added
// from a layer's Video → Stylize menu, and rendered in real WebGL on small
// synthetic frames.

type Rgba = number[];

const PREVIEW = { width: 320, height: 180 };

// Types `value` into the Radius knob's readout.
async function setRadius(blur: Locator, value: string) {
  await typeValue(blur, "Radius", value);
  await expect
    .element(blur.getByRole("slider", { name: "Radius" }))
    .toHaveAttribute("aria-valuetext", `${value} px`);
}

describe("Gaussian Blur", { timeout: 60_000 }, () => {
  test("is added from a layer's Video → Stylize menu and blurs the preview more as Radius grows", async () => {
    // A text clip on layer 1, previewed in its middle.
    let project: ProjectState = withTextClip(EMPTY_PROJECT).project;
    const preview = () => renderFrame(rendererState(project, PREVIEW), 4);
    const sharp = await preview();

    // Clicking the layer header selects the layer.
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
      "Stylize",
      "Gaussian Blur",
      "Video",
    );

    const blur = device("Gaussian Blur");
    await expect
      .element(blur.getByRole("slider", { name: "Radius" }))
      .toHaveAttribute("aria-valuetext", "20 px");
    const animation = blur.getByRole("button", {
      name: "Turn Animation Off for Gaussian Blur",
    });
    await expect.element(animation).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(animation);

    // The default Radius softens the text.
    const atDefault = meanChange(await preview(), sharp);
    expect(atDefault).toBeGreaterThan(0.1);

    // A larger Radius spreads it further.
    await setRadius(blur, "80");
    expect(meanChange(await preview(), sharp)).toBeGreaterThan(atDefault * 1.5);

    // Radius 0 leaves the text sharp.
    await setRadius(blur, "0");
    expect(meanChange(await preview(), sharp)).toBeLessThan(0.02);
  });
});

// A `width`×`height` frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Gaussian Blur of `radius` on the layer, or
// none when it is undefined. Returns every pixel of the middle row as RGBA.
async function renderRow(
  paint: string,
  radius: number | undefined,
  width = 320,
  height = 180,
): Promise<Rgba[]> {
  const effects =
    radius === undefined
      ? []
      : [layerEffect("GaussianBlur", parameters({ _Radius: radius }))];
  return middleRow(
    await renderFrame(fillState(paint, effects, { width, height }), 1, 0.5),
  );
}

// `left` on the left half, `right` on the right, with a hard edge between.
function halves(left: string, right: string) {
  return `linear-gradient(90deg, ${left} 0%, ${left} 50%, ${right} 50%, ${right} 100%)`;
}

const HALF_WHITE = halves("rgba(0,0,0,1)", "rgba(255,255,255,1)");

// The first bright pixel of a row.
function edgeOf(row: Rgba[]) {
  return row.findIndex(([red]) => red > 128);
}

// How many pixels a row takes to rise from 10% to 90% red.
function spread(row: Rgba[]) {
  const first = row.findIndex(([red]) => red > 25);
  const last = row.findIndex(([red]) => red > 230);
  return last - first;
}

describe("Gaussian Blur rendering", { timeout: 60_000 }, () => {
  test("Radius 0 leaves the frame as it was", async () => {
    const plain = await renderRow(HALF_WHITE, undefined);
    expect(await renderRow(HALF_WHITE, 0)).toEqual(plain);
  });

  test("a hard edge blurs into a smooth, symmetric falloff", async () => {
    const plain = await renderRow(HALF_WHITE, undefined);
    const edge = edgeOf(plain);
    expect(plain[edge - 2][0]).toBeLessThan(8);

    // 30 px at 1080p is 5 px of this 180 px frame.
    const row = await renderRow(HALF_WHITE, 30);
    const level = (x: number) => row[x][0];
    expect(level(edge - 1)).toBeGreaterThan(24);
    expect(level(edge)).toBeLessThan(231);
    // Mirrored about the edge, the dark side rises as the bright side
    // falls.
    for (let distance = 0; distance < 8; distance++) {
      expect(
        Math.abs(level(edge - 1 - distance) + level(edge + distance) - 255),
        `distance = ${distance}`,
      ).toBeLessThan(6);
    }
    // No banding: it rises steadily without steps between neighbors.
    for (let x = edge - 10; x < edge + 10; x++) {
      expect(level(x + 1), `x = ${x}`).toBeGreaterThanOrEqual(level(x));
      expect(level(x + 1) - level(x), `x = ${x}`).toBeLessThan(64);
    }
    // Away from the edge the halves keep their colors, out to the frame's
    // own edges, which aren't wrapped around.
    expect(row[10].slice(0, 3)).toEqual([0, 0, 0]);
    expect(row[309].slice(0, 3)).toEqual([255, 255, 255]);
    expect(row[0].slice(0, 3)).toEqual([0, 0, 0]);
    expect(row[319].slice(0, 3)).toEqual([255, 255, 255]);
    // A gray blur stays neutral.
    const [red, green, blue] = row[edge - 1];
    expect(Math.abs(red - green)).toBeLessThan(3);
    expect(Math.abs(red - blue)).toBeLessThan(3);
  });

  test("transparent areas don't darken the edges they meet", async () => {
    // Red fading into transparency must cover the background just as red
    // fading into opaque black covers it with red: the black version's red
    // level is the coverage. Blurring the transparent pixels' color in
    // unweighted would darken it.
    const fading = halves("rgba(255,0,0,1)", "rgba(0,0,0,0)");
    const transparent = await renderRow(fading, 60);
    const black = await renderRow(
      halves("rgba(255,0,0,1)", "rgba(0,0,0,1)"),
      60,
    );
    const background = (await renderRow(fading, undefined))[319];
    for (let x = 140; x < 180; x++) {
      const coverage = black[x][0] / 255;
      const expected = 255 * coverage + background[0] * (1 - coverage);
      expect(Math.abs(transparent[x][0] - expected), `x = ${x}`).toBeLessThan(
        4,
      );
    }
    expect(transparent[165][0] - background[0]).toBeGreaterThan(4);
  });

  test("the Radius scales with the output size", async () => {
    const paint = halves("rgba(0,0,0,1)", "rgba(255,0,0,1)");
    const small = spread(await renderRow(paint, 60, 320, 180));
    const large = spread(await renderRow(paint, 60, 640, 360));
    expect(small).toBeGreaterThan(4);
    expect(Math.abs(large - 2 * small)).toBeLessThanOrEqual(2);
  });

  test("the strongest blur stays smooth", async () => {
    const row = await renderRow(HALF_WHITE, 100, 640, 360);
    const level = (x: number) => row[x][0];
    for (let x = 200; x < 440; x++) {
      expect(level(x + 1), `x = ${x}`).toBeGreaterThanOrEqual(level(x));
      expect(level(x + 1) - level(x), `x = ${x}`).toBeLessThan(12);
    }
    expect(level(310)).toBeGreaterThan(24);
    expect(level(330)).toBeLessThan(231);
  });
});
