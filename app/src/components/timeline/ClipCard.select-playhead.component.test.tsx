import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { click } from "../../component-test/cdp-mouse.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor-harness.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { ClipCard } from "./ClipCard";
import { SourceSpan } from "./SourceSpan";
import { SourceTrackRow } from "./SourceTrackRow";

// Selecting a clip only selects it; the playhead stays where it was, for an
// arrangement clip (ClipCard), a source track's label (SourceTrackRow) and a
// source clip (SourceSpan), in the editor harness that wires them as App
// does. A four-second test pattern at 120 BPM spans eight quarters.
void [ClipCard, SourceSpan, SourceTrackRow];

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`No layer ${id}`);
  }
  return element;
}

function element(selector: string) {
  const match = document.querySelector<HTMLElement>(selector);
  if (!match) {
    throw new Error(`Nothing matches ${selector}`);
  }
  return match;
}

// The playhead's position within the lane, independent of scroll.
function playheadX() {
  return (
    element(".timeline-playhead-marker").getBoundingClientRect().left -
    lane("1").getBoundingClientRect().left
  );
}

// The docked Audio row footer (#809) leaves less room for layers to scroll
// in; the default session's layers no longer all fit without scrolling.
beforeEach(async () => {
  await setViewport({ width: 1600, height: 1200 });
});

test("selecting a clip leaves the playhead where it was", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderEditor({
    project: withTestPatternTrack(sessionWithLayers(2)),
  });
  await expect
    .poll(() => document.querySelectorAll(".source-span").length)
    .toBe(1);
  await userEvent.click(page.elementLocator(element(".source-span")), {
    button: "right",
  });
  await userEvent.hover(page.getByRole("menuitem", { name: "Copy to layer" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Layer 1" }));
  await expect
    .poll(() => lane("1").querySelectorAll(".clip-card").length)
    .toBe(1);
  const clip = element('[data-timeline-lane-id="1"] .clip-card');
  // Keep the lanes clear of the sticky ruler.
  clip.scrollIntoView({ block: "center" });
  const clipBox = clip.getBoundingClientRect();
  const emptyLane = lane("2").getBoundingClientRect();

  // Park the playhead mid-clip from an empty lane, with nothing selected.
  await click(clipBox.x + clipBox.width / 2, emptyLane.y + 20);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => clip.className).not.toMatch(/clip-card--selected/);
  const parked = playheadX();
  expect(parked).toBeGreaterThan(clipBox.width / 4);

  // Stopped: clicking the clip selects it without seeking.
  await userEvent.click(
    page.elementLocator(element(".clip-card .clip-card__body")),
  );
  await expect.poll(() => clip.className).toMatch(/clip-card--selected/);
  expect(playheadX()).toBeCloseTo(parked, 0);

  // Clicking the source track's label selects the track without seeking.
  await userEvent.click(page.elementLocator(element(".track-label--source")));
  await expect
    .poll(() =>
      element(".track-label--source .track-label__select").getAttribute(
        "aria-current",
      ),
    )
    .toBe("true");
  await expect.poll(() => clip.className).not.toMatch(/clip-card--selected/);
  expect(playheadX()).toBeCloseTo(parked, 0);

  // And so does clicking a source clip.
  await userEvent.click(page.elementLocator(element(".source-span")));
  await expect
    .poll(() => element(".source-span").className)
    .toMatch(/source-span--selected/);
  expect(playheadX()).toBeCloseTo(parked, 0);
});
