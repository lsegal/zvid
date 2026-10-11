import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
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
  meanDifference,
  rgb,
  stackDevice,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import "./pass.ts";

// The Caustics video effect (#822): added to a layer from its add menu's
// Video → Stylize submenu, with its controls at their defaults, and lighting
// the preview as its knobs change.

const PREVIEW = { width: 320, height: 180 };

describe("Caustics", { timeout: 60_000 }, () => {
  test("is added from a layer's Video → Stylize menu with its defaults and lights the preview", async () => {
    // A fill clip on layer 1, as Insert Fill Clip makes it, selected and
    // previewed in its middle.
    const fill = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(getSwatch(EMPTY_PROJECT.lanes[0].colorIndex).accent),
    );
    let project: ProjectState = fill.project;
    const preview = async () =>
      rgb(await renderFrame(rendererState(project, PREVIEW), 4));

    await render(
      <FxEditor
        project={project}
        selection={{ clipId: fill.clip.id }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    // A gradient, so the warp has detail to bend.
    await userEvent.click(
      device("Color").getByRole("button", { name: "Gradient" }),
    );
    const plain = await preview();

    await addFromMenu(
      "Add device to this layer",
      "Stylize",
      "Caustics",
      "Video",
    );

    const caustics = stackDevice("Caustics", "layer");
    for (const [label, text] of [
      ["Intensity", "50%"],
      ["Scale", "50%"],
      ["Speed", "30%"],
      ["Warp", "10%"],
    ]) {
      await expect
        .element(caustics.getByRole("slider", { name: label, exact: true }))
        .toHaveAttribute("aria-valuetext", text);
    }
    await expect
      .element(caustics.getByRole("button", { name: "Screen" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(caustics.getByText("Color", { exact: true }))
      .toBeVisible();

    // At its defaults it already lights the layer.
    expect(meanDifference(await preview(), plain)).toBeGreaterThan(1);
    const defaults = await preview();

    // Full intensity added on top lights it far more.
    await typeValue(caustics, "Intensity", "100");
    await userEvent.click(caustics.getByRole("button", { name: "Add" }));
    await expect
      .element(caustics.getByRole("slider", { name: "Intensity", exact: true }))
      .toHaveAttribute("aria-valuetext", "100%");
    expect(meanDifference(await preview(), defaults)).toBeGreaterThan(1);

    // Intensity 0 with Warp 0 leaves the layer as it was.
    await typeValue(caustics, "Intensity", "0");
    await typeValue(caustics, "Warp", "0");
    await expect
      .element(caustics.getByRole("slider", { name: "Warp", exact: true }))
      .toHaveAttribute("aria-valuetext", "0%");
    expect(meanDifference(await preview(), plain)).toBeLessThan(0.5);
  });
});
