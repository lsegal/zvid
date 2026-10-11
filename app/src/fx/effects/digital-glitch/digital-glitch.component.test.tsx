import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { getSwatch } from "../../../app/util.ts";
import { device, typeValue } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  meanDifference,
  scaledRgb,
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
import { setViewport } from "../../../component-test/viewport.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import "./pass.ts";

// The Digital Glitch video effect: added to a layer from its add menu's
// Stylize group, beside Analog Glitch, with its controls at their defaults,
// and glitching the preview once its Amount turns up.

const PREVIEW = { width: 320, height: 180 };

describe("Digital Glitch", { timeout: 60_000 }, () => {
  test("is added to a layer from Video → Stylize with its defaults and glitches the preview", async () => {
    // The viewport the e2e spec used.
    await setViewport({ width: 1600, height: 1200 });
    // A fill clip on layer 1, as Insert Fill Clip makes it, previewed in its
    // middle.
    const fill = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(getSwatch(EMPTY_PROJECT.lanes[0].colorIndex).accent),
    );
    let project: ProjectState = fill.project;
    // The preview downsampled to a 16×16 grid of RGB values.
    const preview = async () =>
      scaledRgb(await renderFrame(rendererState(project, PREVIEW), 4), 16);
    const onChange = (history: { present: ProjectState }) => {
      project = history.present;
    };

    const screen = await render(
      <FxEditor
        key="editor"
        project={project}
        selection={{ clipId: fill.clip.id }}
        onChange={onChange}
      />,
    );
    await userEvent.click(
      device("Color").getByRole("button", { name: "Gradient" }),
    );
    // Clicking the layer header selects the layer.
    await screen.rerender(
      <FxEditor
        key="editor"
        project={project}
        selection={{ laneId: "1" }}
        onChange={onChange}
      />,
    );
    const original = await preview();

    await userEvent.click(
      page.getByRole("button", { name: "Add device to this layer" }),
    );
    page
      .getByRole("menu")
      .getByRole("group", { name: "Video" })
      .getByRole("menuitem", { name: "Stylize", exact: true })
      .element()
      .focus();
    await userEvent.keyboard("{ArrowRight}");
    const submenu = page.getByRole("menu").last();
    await expect
      .element(submenu.getByRole("menuitem", { name: /^Digital Glitch/ }))
      .toBeVisible();
    // Listed after Analog Glitch, among the Stylize effects that followed it.
    const stylize = submenu
      .getByRole("menuitem")
      .elements()
      .map((item) => item.textContent ?? "");
    const analog = stylize.findIndex((name) =>
      name.startsWith("Analog Glitch"),
    );
    expect(analog).toBeGreaterThanOrEqual(0);
    expect(
      stylize.findIndex((name) => name.startsWith("Digital Glitch")),
    ).toBeGreaterThan(analog);
    await userEvent.click(
      submenu.getByRole("menuitem", { name: /^Digital Glitch/ }),
    );

    const glitch = stackDevice("Digital Glitch", "layer");
    for (const [label, text] of [
      ["Amount", "30%"],
      ["Block Size", "40%"],
      ["Displace", "50%"],
      ["Channel Shift", "30%"],
      ["Color Crush", "0%"],
      ["Rate", "8 /s"],
    ]) {
      await expect
        .element(glitch.getByRole("slider", { name: label, exact: true }))
        .toHaveAttribute("aria-valuetext", text);
    }
    // Clip-mode Animation, on for a new device, would ease Amount in from
    // the clip's start; switching it off shows the effect as set.
    await userEvent.click(
      glitch.getByRole("button", { name: /^Turn Animation Off/ }),
    );

    // Amount 0 leaves the frame as it was.
    await typeValue(glitch, "Amount", "0");
    await expect
      .element(glitch.getByRole("slider", { name: "Amount", exact: true }))
      .toHaveAttribute("aria-valuetext", "0%");
    expect(meanDifference(original, await preview())).toBeLessThan(0.5);
    const plain = await preview();

    // Glitching every block at full displacement and crush moves the
    // picture.
    await typeValue(glitch, "Amount", "1");
    await typeValue(glitch, "Displace", "1");
    await typeValue(glitch, "Color Crush", "1");
    await expect
      .element(glitch.getByRole("slider", { name: "Color Crush", exact: true }))
      .toHaveAttribute("aria-valuetext", "100%");
    expect(meanDifference(plain, await preview())).toBeGreaterThan(4);
  });
});
