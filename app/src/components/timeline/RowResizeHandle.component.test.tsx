import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "../../component-test/editor.tsx";
import { copySourceClipToLayer1 } from "../../component-test/editor-steps.ts";
import {
  addLayers,
  center,
  dblclick,
  down,
  isVisible,
  move,
  nextFrames,
  up,
} from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";
import { RowResizeHandle } from "./RowResizeHandle";

// Dragging the separator along the bottom of a layer, source track or Audio
// row handle resizes that row alone, between the 44px collapsed form and 4x
// its default height (#1058). Dragged to the minimum it collapses, and
// double-clicking its handle then expands it to the dragged height.

const COLLAPSED_HEIGHT = 44;

function query(selector: string, root: ParentNode = document) {
  return root.querySelector(selector) as HTMLElement;
}

function layerRow(id = "1") {
  return query(`[data-layer-row-id="${id}"]`);
}

function sourceRow() {
  return query(".track-row--source[data-source-track-id]");
}

function height(element: Element) {
  return element.getBoundingClientRect().height;
}

// Images drawn in a row: its frames and thumbnails.
function thumbnails(row: Element) {
  return row.querySelectorAll(
    ".clip-card__tile, .clip-card__thumb, .source-span__tile, .source-span__thumb",
  );
}

// A video in a source track, copied to Layer 1, both showing frames.
async function addVideoClips() {
  await renderEditor({ project: withTestPatternTrack() });
  await expect.poll(() => layerRow()).toBeTruthy();
  await copySourceClipToLayer1();
}

async function doubleClick(element: Element) {
  const point = center(element);
  await dblclick(point.x, point.y);
}

// Drags a row's separator by dy pixels, right of its grip.
async function dragSeparator(row: Element, dy: number) {
  const separator = query(".row-resize-handle", row);
  separator.scrollIntoView({ block: "nearest" });
  await nextFrames();
  const box = separator.getBoundingClientRect();
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height / 2;
  await move(x, y);
  await down();
  await move(x, y + dy, { steps: 8 });
  await up();
  await nextFrames();
}

describe(RowResizeHandle, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await setViewport({ width: 1600, height: 1200 });
  }, 120_000);

  test("dragging a layer's separator resizes only that lane", async () => {
    await addVideoClips();
    await addLayers(1);
    const row = layerRow();
    const label = query(".track-label", row);
    const separator = query(".row-resize-handle", row);
    const nextRow = layerRow("2");
    expect(getComputedStyle(separator).cursor).toBe("row-resize");
    expect(height(row)).toBe(66);
    const clipHeight = height(query(".clip-card", row));
    const nextTop = nextRow.getBoundingClientRect().y;

    await dragSeparator(row, 40);
    expect(height(row)).toBe(106);
    expect(height(label)).toBe(106);
    expect(height(query(".clip-card", row))).toBeGreaterThan(clipHeight);
    // The rows below move down and keep their height.
    expect(height(nextRow)).toBe(66);
    expect(nextRow.getBoundingClientRect().y).toBe(nextTop + 40);
    expect(separator.getAttribute("aria-valuenow")).toBe("106");

    // No taller than 4x the default.
    await dragSeparator(row, 600);
    expect(height(row)).toBe(264);
    await dragSeparator(row, -164);
    expect(height(row)).toBe(100);

    // Shorter than the default, the handle fits the row.
    await dragSeparator(row, -50);
    expect(height(row)).toBe(50);
    expect(height(label)).toBe(50);
    expect(row.className).toMatch(/track-row--short/);
    expect(row.className).not.toMatch(/track-row--collapsed/);

    // Dragged to the minimum, it collapses, without frames.
    await dragSeparator(row, -100);
    await expect.poll(() => row.className).toMatch(/track-row--collapsed/);
    expect(height(row)).toBe(COLLAPSED_HEIGHT);
    await expect.poll(() => thumbnails(row)).toHaveLength(0);
    expect(height(nextRow)).toBe(66);

    // Double-clicking the handle expands it to the height it was dragged
    // from, and collapses it again.
    const index = query(".track-label__index", label);
    await doubleClick(index);
    await expect.poll(() => row.className).not.toMatch(/track-row--collapsed/);
    expect(height(row)).toBe(50);
    await doubleClick(index);
    await expect.poll(() => height(row)).toBe(COLLAPSED_HEIGHT);
    await doubleClick(index);
    await expect.poll(() => height(row)).toBe(50);
  });

  test("the separator leaves the grip, selection and rename alone", async () => {
    await renderEditor();
    await expect.poll(() => layerRow()).toBeTruthy();
    await addLayers(1);
    const row = layerRow("2");
    const label = query(".track-label", row);
    await doubleClick(query(".track-label__index", label));
    await expect.poll(() => row.className).toMatch(/track-row--collapsed/);

    // The collapsed grip reaches the separator, and stays on top of it.
    const grip = query(".track-label__grip", label);
    const gripBox = grip.getBoundingClientRect();
    const topAtGripBottom = document
      .elementFromPoint(
        gripBox.x + gripBox.width / 2,
        gripBox.y + gripBox.height - 1,
      )
      ?.closest("button")?.className;
    expect(topAtGripBottom).toContain("track-label__grip");

    // Resizing doesn't select the row; clicking its label still does.
    await page.elementLocator(query(".track-label__index", layerRow())).click();
    await expect
      .poll(() => layerRow().className)
      .toMatch(/track-row--selected/);
    expect(row.className).not.toMatch(/track-row--selected/);
    await dragSeparator(row, 10);
    expect(height(row)).toBe(54);
    expect(row.className).not.toMatch(/track-row--selected/);
    await page.elementLocator(query(".track-label__index", label)).click();
    await expect.poll(() => row.className).toMatch(/track-row--selected/);

    // Dragging the grip still reorders the layers.
    const firstRow = () => query(".track-row[data-layer-row-id]");
    expect(firstRow().getAttribute("data-layer-row-id")).toBe("1");
    const target = layerRow().getBoundingClientRect();
    const from = center(grip);
    await move(from.x, from.y);
    await down();
    await move(target.x + 20, target.y + 4, { steps: 10 });
    await up();
    await expect
      .poll(() => firstRow().getAttribute("data-layer-row-id"))
      .toBe("2");
    expect(height(row)).toBe(54);

    // The name still renames.
    await doubleClick(query(".track-label__select", label));
    await expect
      .element(
        page.elementLocator(label).getByRole("textbox", { name: "Layer name" }),
      )
      .toHaveFocus();
  });

  test("dragging a source track's separator resizes only that track", async () => {
    await addVideoClips();
    const row = sourceRow();
    const span = query(".source-span", row);
    expect(height(row)).toBe(82);
    const spanHeight = height(span);

    await dragSeparator(row, 50);
    expect(height(row)).toBe(132);
    expect(height(span)).toBeGreaterThan(spanHeight);
    expect(height(layerRow())).toBe(66);

    // Within the viewport, which the pointer can't leave.
    await dragSeparator(row, 300);
    expect(height(row)).toBe(328);

    await dragSeparator(row, -400);
    await expect.poll(() => row.className).toMatch(/track-row--collapsed/);
    expect(height(row)).toBe(COLLAPSED_HEIGHT);
    await expect.poll(() => thumbnails(row)).toHaveLength(0);
    expect(isVisible(query(".clip-card__tile", layerRow()))).toBe(true);

    await doubleClick(query(".track-label__stripe", row));
    await expect.poll(() => height(row)).toBe(328);
  });

  test("dragging the Audio row's separator resizes and collapses it", async () => {
    await renderEditor();
    await expect.poll(() => query("[data-audio-row]")).toBeTruthy();
    const row = query("[data-audio-row]");
    const toggle = () => query(".audio-row__toggle", row);
    const expanded = () => toggle().getAttribute("aria-expanded");
    expect(height(row)).toBe(78);

    await dragSeparator(row, 30);
    expect(height(row)).toBe(108);
    await dragSeparator(row, -60);
    expect(height(row)).toBe(48);
    expect(height(query(".track-label", row))).toBe(48);

    await dragSeparator(row, -100);
    await expect.poll(expanded).toBe("false");
    expect(height(row)).toBe(COLLAPSED_HEIGHT);

    // The toggle expands it to the height it was dragged from.
    await page.elementLocator(toggle()).click();
    await expect.poll(expanded).toBe("true");
    expect(height(row)).toBe(48);

    // Dragging a collapsed row expands it.
    await page.elementLocator(toggle()).click();
    await expect.poll(expanded).toBe("false");
    await dragSeparator(row, 40);
    await expect.poll(expanded).toBe("true");
    expect(height(row)).toBe(84);
  });
});
