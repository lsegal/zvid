import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { secondsToQuarters } from "../../../app/timeline-math.ts";
import type { ProjectState } from "../../../app/types.ts";
import {
  addFromMenu,
  device,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  meanDifference,
  scaledRgb,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withClipFromSpan,
  withDroppedMedia,
} from "../../../component-test/fx-projects.ts";
import {
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import "./pass.ts";

// Refraction (#823): the layer seen through water or textured glass. It is
// added from the Distort submenu of a layer's add menu, shows its defaults,
// shows Speed only for Water and Angle only for Reeded Glass, and bends the
// preview when its settings change.

const PREVIEW = { width: 320, height: 180 };

// The e2e fixture: a 4 s, 160 × 90 test pattern without sound.
const VIDEO = new URL(
  "../../../../e2e/fixtures/test-pattern.mp4",
  import.meta.url,
);

const panel = () => device("Refraction");

async function pickType(type: string) {
  await userEvent.click(panel().getByRole("combobox", { name: "Type" }));
  await userEvent.click(page.getByRole("option", { name: type, exact: true }));
  await expect
    .element(panel().getByRole("combobox", { name: "Type" }))
    .toHaveTextContent(type);
}

describe("Refraction", { timeout: 60_000 }, () => {
  test("is added from Distort with its defaults and bends the preview", async () => {
    // The test pattern dropped on a new source track, placed on the
    // arrangement and its clip selected.
    const dropped = withDroppedMedia(
      EMPTY_PROJECT,
      mediaItem({
        kind: "video",
        name: "test-pattern.mp4",
        durationSeconds: 4,
        width: 160,
        height: 90,
        previewUrl: VIDEO.href,
        availability: "ready",
      }),
    );
    const placed = withClipFromSpan(dropped.project, dropped.span);
    let project: ProjectState = placed.project;
    // The preview in the clip's middle, downsampled to a 16×16 grid of RGB
    // values.
    const middle =
      placed.clip.startQ +
      secondsToQuarters(placed.clip.durationSeconds / 2, project.bpm);
    const preview = async () =>
      scaledRgb(await renderFrame(rendererState(project, PREVIEW), middle), 16);
    // A new video element can settle on its first loaded frame before the
    // seek to the clip's middle lands, and the pattern moves, so the plain
    // preview is the one two renders in a row agree on.
    let plain = await preview();
    for (let tries = 0; tries < 20; tries++) {
      const next = await preview();
      if (meanDifference(next, plain) === 0) break;
      plain = next;
    }

    await render(
      <FxEditor
        project={project}
        selection={{ clipId: placed.clip.id }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    await addFromMenu("Add device to this layer", "Distort", "Refraction");
    await userEvent.click(
      panel().getByRole("button", {
        name: "Turn Animation Off for Refraction",
      }),
    );

    // The defaults: Water, with Speed and no Angle.
    await expect
      .element(panel().getByRole("combobox", { name: "Type" }))
      .toHaveTextContent("Water");
    for (const [label, value] of [
      ["Amount", "30%"],
      ["Scale", "50%"],
      ["Speed", "20%"],
      ["Dispersion", "0%"],
    ]) {
      await expect
        .element(panel().getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", value);
    }
    expect(
      panel().getByRole("slider", { name: "Angle" }).elements(),
    ).toHaveLength(0);

    // Reeded Glass swaps Speed for Angle, at 90°.
    await pickType("Reeded Glass");
    await expect
      .element(panel().getByRole("slider", { name: "Speed" }))
      .not.toBeInTheDocument();
    await expect
      .element(panel().getByRole("slider", { name: "Angle" }))
      .toHaveAttribute("aria-valuetext", "90°");

    // Large glass blocks at full strength bend the gradient visibly.
    await pickType("Glass Blocks");
    await expect
      .element(panel().getByRole("slider", { name: "Angle" }))
      .not.toBeInTheDocument();
    const before = await preview();
    await typeValue(panel(), "Scale", "1");
    await typeValue(panel(), "Amount", "1");
    await expect
      .element(panel().getByRole("slider", { name: "Amount" }))
      .toHaveAttribute("aria-valuetext", "100%");
    expect(meanDifference(before, await preview())).toBeGreaterThan(4);

    // Amount 0 looks straight through the glass.
    await typeValue(panel(), "Amount", "0");
    await expect
      .element(panel().getByRole("slider", { name: "Amount" }))
      .toHaveAttribute("aria-valuetext", "0%");
    expect(meanDifference(plain, await preview())).toBeLessThan(1);
  });
});
