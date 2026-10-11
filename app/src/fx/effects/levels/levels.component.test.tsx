import { describe, expect, test } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { addFromMenu, device } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  meanColor,
  previewForAnalysis,
} from "../../../component-test/fx-scenes.ts";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import {
  autosavePayload,
  restoreHistory,
} from "../../../component-test/fx-session.ts";
import { mouse } from "../../../component-test/mouse.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import type { ProjectHistoryState } from "../../../project-history";
import "./pass.ts";

// Levels (#1130): grades what it's applied to with Lift, Gamma, Gain and
// Offset color wheels and a tone curve drawn over a histogram of the
// picture reaching it. Added from a layer's Video → Color menu.

const PREVIEW = { width: 320, height: 180 };

// The fill clip spans quarters 0-8; the preview is read in its middle.
const PLAYHEAD_Q = 4;

// The mean red, green and blue of a patch of the preview, away from its
// center and edges.
async function previewColor(project: ProjectState) {
  const frame = await renderFrame(rendererState(project, PREVIEW), PLAYHEAD_Q);
  return meanColor(frame, 0.2, 0.2, 0.15, 0.15);
}

// Drags with the trusted mouse from `from` to `to`, in pixels from the top
// left of `target`, in small steps.
async function drag(
  target: Locator,
  from: [number, number],
  to: [number, number],
) {
  const element = target.element();
  element.scrollIntoView({ block: "center" });
  const box = element.getBoundingClientRect();
  await mouse.move(box.left + from[0], box.top + from[1]);
  await mouse.down();
  await mouse.move(box.left + to[0], box.top + to[1], { steps: 8 });
  await mouse.up();
  return box;
}

// App's own undo and redo shortcuts.
async function undo() {
  await userEvent.keyboard("{Control>}z{/Control}");
}
async function redo() {
  await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
}

describe("Levels", { timeout: 60_000 }, () => {
  test("grades a layer with a color wheel and the curve, over a histogram, and keeps its grade and undo step after a refresh", async () => {
    // Inserting a fill clip on layer 1: a neutral gray.
    let history: ProjectHistoryState<ProjectState> | undefined;
    let project: ProjectState = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(undefined),
    ).project;
    const [plainRed, plainGreen] = await previewColor(project);

    // The preview draws for the histogram while the curve is on screen.
    const stopPreview = previewForAnalysis(
      () => rendererState(project, PREVIEW),
      PLAYHEAD_Q,
    );
    const screen = await render(
      <FxEditor
        project={project}
        selection={{ laneId: "1" }}
        playheadQ={PLAYHEAD_Q}
        onChange={(next) => {
          history = next;
          project = next.present;
        }}
      />,
    );
    try {
      await addFromMenu("Add device to this layer", "Color", "Levels", "Video");

      const levels = () => device("Levels");
      // A static grading tool, it comes with Animation off.
      await expect
        .element(
          levels().getByRole("button", {
            name: "Turn Animation On for Levels",
          }),
        )
        .toHaveAttribute("aria-pressed", "false");
      for (const wheel of ["Lift", "Gamma", "Gain", "Offset"]) {
        await expect
          .element(levels().getByRole("slider", { name: `${wheel} color` }))
          .toBeVisible();
      }
      const gainRed = () => levels().getByRole("textbox", { name: "Gain R" });
      await expect.element(gainRed()).toHaveValue("1.00");

      // The histogram of the gray fill reaching the effect fills in behind
      // the curve.
      levels()
        .element()
        .querySelector('[data-fx-curve="master"]')
        ?.scrollIntoView({ block: "center" });
      await expect
        .poll(
          () =>
            levels()
              .element()
              .querySelector("[data-fx-histogram]")
              ?.getAttribute("d") ?? "",
          { timeout: 10_000 },
        )
        .toMatch(/L/);

      // Its defaults leave the picture as it is.
      expect(
        Math.abs((await previewColor(project))[1] - plainGreen),
      ).toBeLessThan(2);

      // Dragging the Gain puck toward red, at the top, warms the gray: more
      // red, less green.
      await drag(
        levels().getByRole("slider", { name: "Gain color" }),
        [44, 44],
        [44, 4],
      );
      await expect.element(gainRed()).not.toHaveValue("1.00");
      await expect
        .element(levels().getByRole("textbox", { name: "Gain G" }))
        .not.toHaveValue("1.00");
      const [tintedRed, tintedGreen] = await previewColor(project);
      expect(tintedGreen).toBeLessThan(plainGreen - 20);
      expect(tintedRed).toBeGreaterThan(plainRed + 30);

      // Dragging the master curve's white point halfway down darkens it.
      const plot = levels().element().querySelector('[data-fx-curve="master"]');
      if (!plot) {
        throw new Error("The curve is not visible");
      }
      const plotBox = plot.getBoundingClientRect();
      await drag(
        page.elementLocator(plot),
        [plotBox.width - 2, 2],
        [plotBox.width - 2, plotBox.height / 2],
      );
      const whitePoint = () =>
        levels().getByRole("slider", { name: "Master curve point 2" });
      await expect
        .poll(() => whitePoint().element().getAttribute("aria-valuetext"))
        .toMatch(/^in 1.00, out 0.(4|5)/);
      const [, gradedGreen] = await previewColor(project);
      expect(gradedGreen).toBeLessThan(tintedGreen * 0.7);
      const gradedGainRed = (gainRed().element() as HTMLInputElement).value;
      const whitePointText =
        whitePoint().element().getAttribute("aria-valuetext") ?? "";

      // The autosave keeps the curve, and a refresh brings the grade back
      // from it.
      if (!history) {
        throw new Error("No history");
      }
      const payload = autosavePayload(history);
      expect(payload).toMatch(/"0,0 1,0\.\d+\|\|\|"/);
      const restored = restoreHistory(payload);
      project = restored.present;
      await screen.rerender(
        <FxEditor
          key="refreshed"
          history={restored}
          selection={{ laneId: "1" }}
          playheadQ={PLAYHEAD_Q}
          onChange={(next) => {
            history = next;
            project = next.present;
          }}
        />,
      );
      expect(project.clips).toHaveLength(1);
      await expect.poll(() => levels().elements().length).toBe(1);
      await expect.element(gainRed()).toHaveValue(gradedGainRed);
      await expect
        .element(whitePoint())
        .toHaveAttribute("aria-valuetext", whitePointText);
      expect(
        Math.abs((await previewColor(project))[1] - gradedGreen),
      ).toBeLessThan(3);

      // The curve drag is one undo step, kept across the refresh.
      await undo();
      await expect
        .element(whitePoint())
        .toHaveAttribute("aria-valuetext", "in 1.00, out 1.00");
      await redo();
      await expect
        .element(whitePoint())
        .toHaveAttribute("aria-valuetext", whitePointText);
    } finally {
      await stopPreview();
    }
  });
});
