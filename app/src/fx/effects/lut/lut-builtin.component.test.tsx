import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { addFromMenu, device } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  pixelAt,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import {
  colorEffect,
  pixelAtFraction,
  type Rgba,
  syntheticClip,
  syntheticLanes,
  syntheticState,
} from "../../../component-test/fx-scenes.ts";
import {
  libraryPayload,
  restoreHistory,
} from "../../../component-test/fx-session.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import type { ProjectHistoryState } from "../../../project-history";
import { getLutMedia } from "./lut-media.ts";
import "./pass.ts";

// The film-look LUTs bundled with zvid (#1136): listed under "Built-in" in
// the LUT effect's picker, stored by a stable id, and read from the app's own
// public/luts/ files, so a session using one needs no imported media.

const BUILT_IN_NAMES = [
  "Black & White Film",
  "Sepia",
  "Faded Vintage Print",
  "Warm 70s Film",
  "Cool 90s Film",
  "Bleach Bypass",
  "Cross-Processed",
  "Two-Strip Color",
  "High-Contrast Film",
  "Teal & Orange",
];

// Sepia turns the default gray fill warm: red well above blue.
const isSepia = ([red, green, blue]: Rgba) =>
  red - blue > 25 && red > green && green > blue;
const isGray = ([red, green, blue]: Rgba) =>
  Math.max(red, green, blue) - Math.min(red, green, blue) < 6;

// Runs first in the file, before anything has loaded a bundled look's file.
describe("LUT built-in rendering", { timeout: 60_000 }, () => {
  test("an exact frame waits for a built-in look's file", async () => {
    const frame = await renderFrame(
      syntheticState(64, 32, {
        clips: [syntheticClip("1")],
        lanes: syntheticLanes(1),
        effects: [
          colorEffect("1", "rgba(128,128,128,1)"),
          {
            id: "lut-1",
            trackId: "1",
            effectName: "LUT",
            enabled: true,
            parameters: [
              { key: "LUT", value: "builtin:sepia" },
              { key: "_Intensity", value: "1", numericValue: 1 },
            ],
          },
        ],
      }),
      1,
      0.5,
    );
    // The e2e spec read the pixel at (32, 16) counted from the bottom.
    const pixel = pixelAt(frame, 32, 32 - 1 - 16);
    // Sepia maps mid-gray halfway from its brown shadows to its cream
    // highlights: about (144, 129, 105).
    expect(isSepia(pixel), String(pixel)).toBe(true);
  });
});

const PREVIEW = { width: 320, height: 180 };

// The fill clip spans quarters 0-8; the preview is read in its middle.
const PLAYHEAD_Q = 4;

// The preview's color left of center.
async function previewColor(project: ProjectState) {
  const frame = await renderFrame(rendererState(project, PREVIEW), PLAYHEAD_Q);
  return pixelAtFraction(frame, 0.3, 0.5);
}

describe("LUT built-in looks", { timeout: 60_000 }, () => {
  test("a built-in look grades the layer and survives a save and reopen", async () => {
    let history: ProjectHistoryState<ProjectState> | undefined;
    let project: ProjectState = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(undefined),
    ).project;
    expect(isGray(await previewColor(project))).toBe(true);
    const onChange = (next: ProjectHistoryState<ProjectState>) => {
      history = next;
      project = next.present;
    };

    const screen = await render(
      <FxEditor
        project={project}
        selection={{ laneId: "1" }}
        playheadQ={PLAYHEAD_Q}
        onChange={onChange}
      />,
    );
    await addFromMenu("Add device to this layer", "Color", "LUT", "Video");
    const lut = () => device("LUT");
    await expect.poll(() => lut().elements().length).toBe(1);

    // The picker lists every bundled look under Built-in, with no media.
    const trigger = () => lut().getByRole("button", { name: /^LUT: / });
    await expect.element(trigger()).toHaveAccessibleName("LUT: None");
    await userEvent.click(trigger());
    const menu = page.getByRole("menu");
    await expect
      .element(menu.getByText("Built-in", { exact: true }))
      .toBeVisible();
    expect(
      menu
        .getByRole("menuitemcheckbox")
        .elements()
        .map((item) => item.textContent),
    ).toEqual(["None", ...BUILT_IN_NAMES]);
    await userEvent.click(
      menu.getByRole("menuitemcheckbox", { name: "Sepia" }),
    );
    await expect.element(trigger()).toHaveAccessibleName("LUT: Sepia");
    expect(isSepia(await previewColor(project))).toBe(true);

    // Another look grades the picture differently.
    await userEvent.click(trigger());
    await userEvent.click(
      page
        .getByRole("menu")
        .getByRole("menuitemcheckbox", { name: "Black & White Film" }),
    );
    await expect
      .element(trigger())
      .toHaveAccessibleName("LUT: Black & White Film");
    expect(isGray(await previewColor(project))).toBe(true);
    await userEvent.click(trigger());
    await userEvent.click(
      page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Sepia" }),
    );
    await expect.element(trigger()).toHaveAccessibleName("LUT: Sepia");
    expect(isSepia(await previewColor(project))).toBe(true);

    // Saved to Sessions and reopened, it still has the look picked and
    // grading, without any LUT media.
    if (!history) {
      throw new Error("No history");
    }
    const reopened = restoreHistory(libraryPayload(history));
    expect(reopened.present.mediaItems).toEqual([]);
    expect(getLutMedia()).toEqual([]);
    project = reopened.present;
    await screen.rerender(
      <FxEditor
        key="reopened"
        history={reopened}
        selection={{ laneId: "1" }}
        playheadQ={PLAYHEAD_Q}
        onChange={onChange}
      />,
    );
    await expect.element(trigger()).toHaveAccessibleName("LUT: Sepia");
    expect(isSepia(await previewColor(project))).toBe(true);
  });
});
