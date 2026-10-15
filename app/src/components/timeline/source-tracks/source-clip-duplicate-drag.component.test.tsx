import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../../app/shortcut-labels.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../../component-test/editor.tsx";
import {
  center,
  click,
  down,
  type Modifier,
  move,
  nextFrames,
  undo,
  up,
} from "../../../component-test/input.ts";

// Ctrl/Cmd-dragging a source clip drags a copy of it, like a layer clip,
// while a Ctrl/Cmd-click without a drag still adds it to the arrangement.

// Ctrl, or Cmd on macOS, like Playwright's ControlOrMeta.
const MOD: Modifier = getShortcutLabels().mac ? "Meta" : "Control";

function spans() {
  return [...document.querySelectorAll<HTMLElement>(".source-span")];
}

function arrangementClips() {
  return document.querySelectorAll("[data-timeline-lane-id] .clip-card");
}

function left(span: HTMLElement) {
  return Number.parseFloat(span.style.left);
}

test("a Ctrl/Cmd-drag duplicates a source clip in one undo step, and a Ctrl/Cmd-click still adds it to the arrangement", {
  timeout: EDITOR_TEST_TIMEOUT,
}, async () => {
  await renderEditor({ project: withTestPatternTrack(sessionWithLayers(1)) });
  await expect.poll(() => spans().length).toBe(1);
  const [original] = spans();
  const originalId = original.dataset.sourceSpanId;
  const widthPx = original.getBoundingClientRect().width;
  const body = original.querySelector(".source-span__body") ?? original;
  const start = center(body);

  // Drag a copy one clip length later, with Shift held to skip snapping,
  // previewing it before the release.
  const modifiers: Modifier[] = [MOD, "Shift"];
  await userEvent.keyboard(`{${MOD}>}{Shift>}`);
  await move(start.x, start.y, { modifiers });
  await down({ modifiers });
  await move(start.x + widthPx, start.y, { steps: 8, modifiers });
  await expect.poll(() => spans().length).toBe(2);
  await up({ modifiers });
  await userEvent.keyboard(`{/Shift}{/${MOD}}`);
  await nextFrames();

  // The original stays put, the copy lands where it was released, and the
  // release adds nothing to the arrangement.
  await expect.poll(() => spans().length).toBe(2);
  const kept = spans().find((span) => span.dataset.sourceSpanId === originalId);
  const copy = spans().find((span) => span.dataset.sourceSpanId !== originalId);
  expect(kept && left(kept)).toBe(0);
  expect(copy && Math.abs(left(copy) - widthPx)).toBeLessThan(1);
  expect(arrangementClips()).toHaveLength(0);

  // One undo takes the copy away.
  await undo();
  await expect.poll(() => spans().length).toBe(1);
  expect(spans()[0].dataset.sourceSpanId).toBe(originalId);

  // A Ctrl/Cmd-click without a drag still adds the clip to the arrangement.
  const press = center(spans()[0].querySelector(".source-span__body") ?? spans()[0]);
  await userEvent.keyboard(`{${MOD}>}`);
  await click(press.x, press.y, { modifiers: [MOD] });
  await userEvent.keyboard(`{/${MOD}}`);
  await expect.poll(() => arrangementClips().length).toBe(1);
  expect(spans()).toHaveLength(1);
});
