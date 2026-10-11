import { describe, expect, test } from "vitest";
import type { Locator } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { getSwatch } from "../../../app/util.ts";
import {
  addFromMenu,
  device,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  fillState,
  layerEffect,
  meanGray,
  parameters,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  pixelAt,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import "./pass.ts";

// Exposure (#1127): brightens or darkens what it's applied to in stops.
// Added from a layer's Video → Color menu, and rendered in real WebGL on
// small synthetic frames.

const PREVIEW = { width: 320, height: 180 };

// Types `value` into the Exposure knob's readout and waits for `readout`.
async function setStops(exposure: Locator, value: string, readout: string) {
  await typeValue(exposure, "Exposure", value);
  await expect
    .element(exposure.getByRole("slider", { name: "Exposure" }))
    .toHaveAttribute("aria-valuetext", readout);
}

describe("Exposure", { timeout: 60_000 }, () => {
  test("is added from a layer's Video → Color menu and brightens the preview as the knob moves up", async () => {
    // A fill clip on layer 1, as Insert Fill Clip makes it, previewed in its
    // middle.
    let project: ProjectState = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(getSwatch(EMPTY_PROJECT.lanes[0].colorIndex).accent),
    ).project;
    // The preview's mean gray level.
    const brightness = async () =>
      meanGray(await renderFrame(rendererState(project, PREVIEW), 4));
    const plain = await brightness();

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
    await addFromMenu("Add device to this layer", "Color", "Exposure", "Video");

    const exposure = device("Exposure");
    await expect
      .element(exposure.getByRole("slider", { name: "Exposure" }))
      .toHaveAttribute("aria-valuetext", "0.0 EV");
    // A static grading tool, it comes with Animation off.
    await expect
      .element(
        exposure.getByRole("button", {
          name: "Turn Animation On for Exposure",
        }),
      )
      .toHaveAttribute("aria-pressed", "false");

    // 0 stops leaves the preview as it was.
    expect(Math.abs((await brightness()) - plain)).toBeLessThan(0.5);

    // Each stop up brightens it further.
    await setStops(exposure, "1", "+1.0 EV");
    const oneStop = await brightness();
    expect(oneStop).toBeGreaterThan(plain + 5);
    await setStops(exposure, "2", "+2.0 EV");
    expect(await brightness()).toBeGreaterThan(oneStop + 5);

    // Stops down darken it.
    await setStops(exposure, "-1", "-1.0 EV");
    expect(await brightness()).toBeLessThan(plain - 5);
  });
});

// The middle pixel of a `width`×`height` frame of one fill clip painted
// `paint` (a CSS color) on Layer 1, with an Exposure of `stops` on the
// layer, or none when it is undefined.
async function renderPixel(
  paint: string,
  stops: number | undefined,
  width = 64,
  height = 36,
) {
  const effects =
    stops === undefined
      ? []
      : [layerEffect("Exposure", parameters({ _Stops: stops }))];
  const frame = await renderFrame(
    fillState(paint, effects, { width, height }),
    1,
    0.5,
  );
  // The e2e spec read the pixel at the middle counted from the bottom.
  return pixelAt(
    frame,
    Math.floor(width / 2),
    height - 1 - Math.floor(height / 2),
  );
}

// An 8-bit sRGB level in linear light.
function toLinear(level: number) {
  const value = level / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

describe("Exposure rendering", { timeout: 60_000 }, () => {
  test("0 stops leaves the frame as it was", async () => {
    const paint = "rgb(120,60,200)";
    expect(await renderPixel(paint, 0)).toEqual(
      await renderPixel(paint, undefined),
    );
  });

  test("each stop doubles or halves the linear light", async () => {
    const paint = "rgb(100,60,30)";
    const plain = await renderPixel(paint, undefined);
    const up = await renderPixel(paint, 1);
    const down = await renderPixel(paint, -1);
    for (let channel = 0; channel < 3; channel++) {
      const linear = toLinear(plain[channel]);
      expect(
        Math.abs(toLinear(up[channel]) - 2 * linear),
        `+1, channel ${channel}`,
      ).toBeLessThan(0.01);
      expect(
        Math.abs(toLinear(down[channel]) - linear / 2),
        `-1, channel ${channel}`,
      ).toBeLessThan(0.01);
    }
    expect(up[3]).toBe(plain[3]);
    expect(down[3]).toBe(plain[3]);
  });

  test("clamps to the displayable range", async () => {
    const [red, green, blue] = await renderPixel("rgb(200,128,0)", 4);
    expect(red).toBe(255);
    expect(green).toBe(255);
    expect(blue).toBe(0);
  });
});
