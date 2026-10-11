import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import testPatternUrl from "../../../e2e/fixtures/test-pattern.mp4?url";
import { INITIAL_PROJECT_STATE } from "../../app/constants.ts";
import {
  renderTimelineEditor,
  TIMELINE_EDITOR_TIMEOUT,
} from "../../component-test/timeline-editor.tsx";
import { center, click, drag } from "../../component-test/timeline-mouse.ts";
import type { MediaItem } from "../../media";
import { addMediaToSourceTrack } from "../../source-track-media.ts";
import { SourceSpan } from "./SourceSpan";

// Snapping always follows the zoom-adaptive grid (#732). A four-second test
// pattern at 120 BPM spans eight quarters. At 100% zoom the grid is in
// eighth notes (half a quarter); at 25% it is in quarters.

const testPattern: MediaItem = {
  id: "media-test-pattern",
  name: "test-pattern.mp4",
  kind: "video",
  durationSeconds: 4,
  width: 160,
  height: 90,
  fps: 15,
  hasAudio: false,
  hasVideo: true,
  color: "#3d4052",
  accent: "#7ca1ff",
  previewUrl: testPatternUrl,
  availability: "ready",
};

function span() {
  return document.querySelector<HTMLElement>(
    '[data-source-track-drop-target="track"] .source-span',
  );
}

function quarterWidth(element: HTMLElement) {
  return element.getBoundingClientRect().width / 8;
}

// Where a span starts in its track, in quarters.
function startQ(element: HTMLElement, quarterPx: number) {
  return (
    Math.round((Number.parseFloat(element.style.left) / quarterPx) * 100) / 100
  );
}

// Drags the span's body horizontally by `deltaPx`, snapping as usual.
async function dragBy(element: HTMLElement, deltaPx: number) {
  const body = element.querySelector(".source-span__body") as HTMLElement;
  body.scrollIntoView({ block: "nearest", inline: "nearest" });
  const from = center(body);
  await drag(from, { x: from.x + deltaPx, y: from.y }, { steps: 8 });
}

describe(SourceSpan, { timeout: TIMELINE_EDITOR_TIMEOUT }, () => {
  test("dragging a clip snaps to the zoom-dependent grid", async () => {
    // One source track holding the test pattern at 0, as dropping it does.
    await renderTimelineEditor({
      project: {
        mediaItems: [testPattern],
        ...addMediaToSourceTrack(INITIAL_PROJECT_STATE, [testPattern], {
          kind: "new-track",
        }),
      },
    });
    await expect.poll(span).not.toBeNull();
    const element = span() as HTMLElement;
    const quarterPx = quarterWidth(element);
    expect(startQ(element, quarterPx)).toBe(0);

    // At 100% the grid is in eighth notes, so 3.4 quarters snaps to 3.5.
    await dragBy(element, 3.4 * quarterPx);
    await expect.poll(() => startQ(span() as HTMLElement, quarterPx)).toBe(3.5);
    await userEvent.keyboard("{Control>}z{/Control}");
    await expect.poll(() => startQ(span() as HTMLElement, quarterPx)).toBe(0);

    // Zoomed out to 25% the grid is in quarters, so 3.4 quarters snaps to 3.
    const zoomOut = document.querySelector(
      'button[aria-label="Zoom out"]',
    ) as HTMLButtonElement;
    while (!zoomOut.disabled) {
      await click(center(zoomOut).x, center(zoomOut).y);
    }
    await expect
      .poll(() => document.querySelector(".zoom-control__readout")?.textContent)
      .toBe("25%");
    const zoomedQuarterPx = quarterWidth(span() as HTMLElement);
    await dragBy(span() as HTMLElement, 3.4 * zoomedQuarterPx);
    await expect
      .poll(() => startQ(span() as HTMLElement, zoomedQuarterPx))
      .toBe(3);
  });
});
