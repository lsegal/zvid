import { expect, test } from "vitest";
import type { ProjectState } from "../app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../component-test/editor.tsx";
import { click, down, move, up } from "../component-test/input.ts";
import { setViewport } from "../component-test/viewport.ts";
import { readLayerTransformPosition } from "../preview-edit.ts";
import { PreviewTransformOverlay } from "./PreviewTransformOverlay";

// With no layer clips the preview renders the source tracks in place of
// layers (resolveRenderClips). Their clips are selected, outlined and moved
// in the preview like layer clips, each in its own source clip stack.
void PreviewTransformOverlay;

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

function outline() {
  return document.querySelector<HTMLElement>(
    '[data-testid="preview-transform-outline"]',
  );
}

test("selects a source clip in the preview and moves it with its own Transform", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await setViewport({ width: 1600, height: 1200 });
  let project: ProjectState | undefined;
  await renderEditor({
    project: withTestPatternTrack(sessionWithLayers(1)),
    preview: true,
    onState: (next) => {
      project = next.project;
    },
  });
  await expect
    .poll(() => document.querySelectorAll(".preview-placeholder").length, {
      timeout: 30_000,
    })
    .toBe(0);
  const span = element(".source-span");
  const spanId = project?.sourceSpans[0]?.id;
  expect(spanId).toBeDefined();
  expect(outline()).toBeNull();

  // Clicking the clip in the preview selects it, and outlines it. The press
  // is clear of its origin, at its center.
  const video = videoRect();
  const grab = {
    x: video.left + video.width / 4,
    y: video.top + video.height / 2,
  };
  await click(grab.x, grab.y);
  await expect
    .poll(() => [...span.classList])
    .toContain("source-span--selected");
  await expect.poll(outline).not.toBeNull();
  const before = outline()?.getBoundingClientRect();

  // Dragging it moves it down, in the source clip's own Transform.
  await move(grab.x, grab.y);
  await down();
  await move(grab.x, grab.y + video.height * 0.1, { steps: 4 });
  await move(grab.x, grab.y + video.height * 0.2, { steps: 4 });
  await up();
  const trackId = `source-clip:${spanId}`;
  await expect
    .poll(() => readLayerTransformPosition(project?.effects ?? [], trackId).y)
    .toBeGreaterThan(0.1);
  await expect
    .poll(() => (outline()?.getBoundingClientRect().y ?? 0) - (before?.y ?? 0))
    .toBeGreaterThan(video.height * 0.15);
});
