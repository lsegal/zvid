import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import {
  click,
  down,
  type Modifier,
  move,
  up,
} from "../../component-test/cdp-mouse.ts";
import {
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor-harness.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { ClipCard } from "./ClipCard";

// A clip Ctrl/Cmd-dragged to duplicate it (ClipCard) is drawn with its
// source clip's stack while it is dragged, as it is once dropped, instead
// of jumping to its clip Transform on release. The editor harness wires the
// timeline and the preview as App does.
void ClipCard;

// Ctrl, or Cmd on macOS, like Playwright's ControlOrMeta.
const MOD: Modifier = getShortcutLabels().mac ? "Meta" : "Control";

function lanes() {
  return [...document.querySelectorAll<HTMLElement>("[data-timeline-lane-id]")];
}

function element(selector: string) {
  const match = document.querySelector<HTMLElement>(selector);
  if (!match) {
    throw new Error(`Nothing matches ${selector}`);
  }
  return match;
}

// The letterboxed video inside the monitor, in page coordinates.
function videoRect() {
  const canvas = element(".composition-player__canvas") as HTMLCanvasElement;
  const bounds = canvas.getBoundingClientRect();
  const fit = Math.min(
    bounds.width / canvas.width,
    bounds.height / canvas.height,
  );
  const width = canvas.width * fit;
  const height = canvas.height * fit;
  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
  };
}

// The selected layer's outline, as fractions of the video, which the
// monitor may lay out differently once the drag ends.
function outlineBox() {
  const box = element(
    '[data-testid="preview-transform-outline"]',
  ).getBoundingClientRect();
  const video = videoRect();
  return {
    x: (box.x - video.left) / video.width,
    y: (box.y - video.top) / video.height,
    width: box.width / video.width,
    height: box.height / video.height,
  };
}

function transformRegions() {
  return page.getByRole("region", { name: "Transform", exact: true }).elements()
    .length;
}

// Tall enough to show the layers the clip is dragged between.
beforeEach(async () => {
  await setViewport({ width: 1600, height: 1400 });
});

test("a Ctrl/Cmd-drag duplicate keeps its clip Transform during the drag", async () => {
  await renderEditor({
    project: withTestPatternTrack(sessionWithLayers(2)),
    preview: true,
  });
  // A new session's Order slides each layer in as its clip starts, so at
  // the playhead a clip was just placed at the layer isn't there yet. This
  // test needs it in place, so it turns that animation off.
  await userEvent.click(
    page.getByRole("button", { name: "Turn Animation Off for Order" }),
  );
  await expect
    .element(page.getByRole("button", { name: "Turn Animation On for Order" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.click(page.elementLocator(element(".source-span")), {
    button: "right",
  });
  await userEvent.hover(page.getByRole("menuitem", { name: "Copy to layer" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Layer 1" }));
  await expect
    .poll(() => document.querySelectorAll(".preview-placeholder").length, {
      timeout: 30_000,
    })
    .toBe(0);

  // Dragging the layer in the preview gives the clip its own Transform,
  // moving it right.
  const video = videoRect();
  const grab = {
    x: video.left + video.width / 2,
    y: video.top + video.height * 0.25,
  };
  await click(grab.x, grab.y);
  await move(grab.x, grab.y);
  await down();
  await move(grab.x + video.width * 0.1, grab.y, { steps: 4 });
  await move(grab.x + video.width * 0.2, grab.y, { steps: 4 });
  await up();
  await expect.poll(transformRegions).toBe(1);

  // Ctrl/Cmd-drag the clip down to the next layer, at the same time.
  // Grab the body, clear of the trim handles.
  const [firstLane, targetLane] = lanes();
  const clipBounds = element(
    '[data-timeline-lane-id="1"] .clip-card .clip-card__body',
  ).getBoundingClientRect();
  const targetBounds = targetLane.getBoundingClientRect();
  const start = {
    x: clipBounds.x + clipBounds.width / 2,
    y: clipBounds.y + clipBounds.height / 2,
  };
  await userEvent.keyboard(`{${MOD}>}`);
  await move(start.x, start.y, { modifiers: [MOD] });
  await down({ modifiers: [MOD] });
  await move(start.x, targetBounds.y + targetBounds.height / 2, {
    steps: 6,
    modifiers: [MOD],
  });
  await expect
    .poll(() => targetLane.querySelectorAll(".clip-card").length)
    .toBe(1);

  // The copy is selected, and its outline sits where its Transform puts it.
  const during = outlineBox();

  await up({ modifiers: [MOD] });
  await userEvent.keyboard(`{/${MOD}}`);
  await expect
    .poll(() => firstLane.querySelectorAll(".clip-card").length)
    .toBe(1);
  await expect
    .poll(() => targetLane.querySelectorAll(".clip-card").length)
    .toBe(1);
  // The copy got its own stack on the drop.
  await expect.poll(transformRegions).toBe(1);

  const after = outlineBox();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(during[key] - after[key]), key).toBeLessThan(0.01);
  }
});
