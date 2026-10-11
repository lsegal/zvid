import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { setViewport } from "./component-test/viewport.ts";
import {
  projectWithMedia,
  TimelineHarness,
  testPatternVideo,
} from "./components/timeline/timeline-harness";
import {
  addLayers,
  center,
  copySourceClipToLayer1,
  isVisible,
  mouse,
} from "./components/timeline/timeline-harness-input";
// What collapses a row and how tall it is; importing it ties these tests
// to it.
import "./row-heights.ts";

// Double-clicking a layer, source track or Audio row handle outside its name
// collapses the row to 44px, with a 28px clip 8px down and no frames, and
// double-clicking it again expands it back (#1057). The name still renames.
// Collapsing keeps the handle's and clips' font sizes and doesn't move the
// index or name sideways (#1073), and the index badge keeps its expanded
// size and style, 8px from the row's top and bottom (#1077). The handle's
// Hide, FX and arm switches and the clips' type glyphs show as expanded
// (#1083).

const COLLAPSED_HEIGHT = 44;
const COLLAPSED_CLIP_HEIGHT = 28;
const COLLAPSED_CLIP_INSET = 8;

function query(selector: string, root: ParentNode = document) {
  return root.querySelector(selector) as HTMLElement;
}

function layerRow() {
  return query('[data-layer-row-id="1"]');
}

function sourceRow() {
  return query(".track-row--source[data-source-track-id]");
}

function height(element: Element) {
  return element.getBoundingClientRect().height;
}

function expectVisible(element: Element | null, visible = true) {
  expect(isVisible(element), element?.className).toBe(visible);
}

// A video in a source track, copied to Layer 1, both showing frames.
async function addVideoClips() {
  await render(
    <TimelineHarness project={projectWithMedia([testPatternVideo()])} />,
  );
  await expect.poll(() => layerRow()).toBeTruthy();
  await copySourceClipToLayer1();
}

// Double-clicks a row's label just right of its name, where nothing else is.
async function doubleClickBesideName(label: Element) {
  const name = query(".track-label__select", label).getBoundingClientRect();
  await mouse.dblclick(name.x + name.width + 6, name.y + name.height / 2);
}

// Double-clicks an element's center.
async function doubleClick(element: Element) {
  const point = center(element);
  await mouse.dblclick(point.x, point.y);
}

function fontSize(element: Element) {
  return getComputedStyle(element).fontSize;
}

// Where a row's handle puts its grip, index (layers only) and name, the
// font sizes of its name, index and clip label, and the index badge's size
// and style.
function labelLayout(label: Element, clipText: Element) {
  const parts = {
    grip: label.querySelector(".track-label__grip"),
    index: label.querySelector(".track-label__index"),
    name: label.querySelector(".track-label__select > span"),
  };
  const layout: Record<string, number | string> = {
    clipFontSize: fontSize(clipText),
  };
  for (const [part, element] of Object.entries(parts)) {
    if (!element) {
      continue;
    }
    const box = element.getBoundingClientRect();
    layout[`${part}Left`] = box.x;
    if (part !== "grip") {
      layout[`${part}FontSize`] = fontSize(element);
    }
    if (part === "index") {
      layout.indexWidth = box.width;
      layout.indexHeight = box.height;
      const style = getComputedStyle(element);
      Object.assign(layout, {
        indexBorderRadius: style.borderRadius,
        indexBorder: style.border,
        indexFontFamily: style.fontFamily,
        indexLineHeight: style.lineHeight,
      });
    }
  }
  return layout;
}

// The collapsed row's index badge is 8px (to within half a pixel) from the
// row's top and bottom.
function expectBadgePadding(row: Element, label: Element) {
  const rowBox = row.getBoundingClientRect();
  const badgeBox = query(".track-label__index", label).getBoundingClientRect();
  const above = badgeBox.y - rowBox.y;
  const below = rowBox.y + rowBox.height - (badgeBox.y + badgeBox.height);
  expect(Math.abs(above - COLLAPSED_CLIP_INSET), "above").toBeLessThanOrEqual(
    0.5,
  );
  expect(Math.abs(below - COLLAPSED_CLIP_INSET), "below").toBeLessThanOrEqual(
    0.5,
  );
}

// Collapsing kept the expanded font sizes and x positions (to within half a
// pixel) and the index badge's size and style, and the name fits the row.
function expectSameLayout(
  label: Element,
  clipText: Element,
  expanded: ReturnType<typeof labelLayout>,
) {
  const collapsed = labelLayout(label, clipText);
  expect(Object.keys(collapsed)).toEqual(Object.keys(expanded));
  for (const [key, value] of Object.entries(expanded)) {
    if (typeof value === "number") {
      expect(Math.abs(Number(collapsed[key]) - value), key).toBeLessThan(0.5);
    } else {
      expect(collapsed[key], key).toBe(value);
    }
  }
  const name = query(".track-label__select > span", label);
  expect(name.scrollHeight <= name.clientHeight).toBe(true);
}

// The sizes and x positions of a handle's Hide, FX and arm switches.
const SWITCHES = [
  ".track-label__hide",
  ".track-label__fx",
  ".track-label__arm",
];

function switchBoxes(label: Element) {
  const boxes: Record<string, { x: number; width: number; height: number }> =
    {};
  for (const selector of SWITCHES) {
    const element = label.querySelector(selector);
    if (!element) {
      continue;
    }
    const box = element.getBoundingClientRect();
    boxes[selector] = { x: box.x, width: box.width, height: box.height };
  }
  return boxes;
}

// The collapsed handle shows its switches at their expanded size and x
// position (to within half a pixel), vertically centered in the row, and
// clicking each one toggles it without expanding the row.
async function expectSwitchesAsExpanded(
  row: Element,
  label: Element,
  expanded: ReturnType<typeof switchBoxes>,
) {
  const rowBox = row.getBoundingClientRect();
  const collapsed = switchBoxes(label);
  expect(Object.keys(collapsed)).toEqual(Object.keys(expanded));
  for (const [selector, box] of Object.entries(expanded)) {
    const element = query(selector, label);
    expectVisible(element);
    for (const key of ["x", "width", "height"] as const) {
      expect(
        Math.abs(collapsed[selector][key] - box[key]),
        `${selector} ${key}`,
      ).toBeLessThan(0.5);
    }
    const switchBox = element.getBoundingClientRect();
    // Centered in the row, less its 1px bottom border.
    const middle = switchBox.y + switchBox.height / 2 - rowBox.y;
    expect(Math.abs(middle - (rowBox.height - 1) / 2), selector).toBeLessThan(
      1,
    );
    const pressed = element.getAttribute("aria-pressed");
    await page.elementLocator(element).click();
    await expect
      .poll(() => query(selector, label).getAttribute("aria-pressed"))
      .not.toBe(pressed);
    await page.elementLocator(query(selector, label)).click();
    await expect
      .poll(() => query(selector, label).getAttribute("aria-pressed"))
      .toBe(pressed);
    expect(row.className).toMatch(/track-row--collapsed/);
  }
}

// Images drawn in a row: its frames and thumbnails.
function thumbnails(row: Element) {
  return row.querySelectorAll(
    ".clip-card__tile, .clip-card__thumb, .source-span__tile, .source-span__thumb",
  );
}

// Draws a selection across Layer 1's empty lane and inserts a clip there
// from the selection's context menu.
async function insertClip(item: string, from: number) {
  const bounds = query('[data-timeline-lane-id="1"]').getBoundingClientRect();
  const y = bounds.y + bounds.height / 2;
  await mouse.move(bounds.x + from, y);
  await mouse.down();
  await mouse.move(bounds.x + from + 100, y);
  await mouse.move(bounds.x + from + 220, y);
  await mouse.up();
  await mouse.click(bounds.x + from + 110, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: item })
    .click();
}

describe("collapsing rows", () => {
  beforeEach(async () => {
    localStorage.clear();
    await setViewport({ width: 1600, height: 1200 });
  });

  test("double-clicking a layer's header collapses and expands its lane", async () => {
    await addVideoClips();
    // Another layer, to check it keeps its height.
    await addLayers(1);
    const row = layerRow();
    const label = query(".track-label", row);
    const clipText = query(".clip-card__text strong", row);
    const expandedHeight = height(row);
    expect(expandedHeight).toBe(66);
    const expandedLayout = labelLayout(label, clipText);
    const expandedSwitches = switchBoxes(label);
    expect(Object.keys(expandedSwitches)).toEqual([
      ".track-label__hide",
      ".track-label__fx",
    ]);

    await doubleClick(query(".track-label__index", label));
    await expect.poll(() => row.className).toMatch(/track-row--collapsed/);
    expectSameLayout(label, query(".clip-card__text strong", row), expandedLayout);
    expect(height(row)).toBe(COLLAPSED_HEIGHT);
    expect(height(label)).toBe(COLLAPSED_HEIGHT);
    expectBadgePadding(row, label);
    const clip = query(".clip-card", row);
    expect(height(clip)).toBe(COLLAPSED_CLIP_HEIGHT);
    expect(clip.offsetTop).toBe(COLLAPSED_CLIP_INSET);
    await expect.poll(() => thumbnails(row)).toHaveLength(0);
    expectVisible(query(".clip-card__text strong", clip));
    // Grip, index, name and switches stay; the summary hides.
    expectVisible(query(".track-label__grip", label));
    expectVisible(query(".track-label__index", label));
    expectVisible(query(".track-label__select > span", label));
    expectVisible(query("small", label), false);
    await expectSwitchesAsExpanded(row, label, expandedSwitches);
    // Other rows keep their height and frames.
    expect(height(query('[data-layer-row-id="2"]'))).toBe(66);
    expectVisible(query(".source-span__tile", sourceRow()));

    await doubleClickBesideName(label);
    await expect.poll(() => row.className).not.toMatch(/track-row--collapsed/);
    expect(height(row)).toBe(expandedHeight);
    await expect
      .poll(() => isVisible(row.querySelector(".clip-card__tile")))
      .toBe(true);

    // The name still renames, without collapsing the row.
    await doubleClick(query(".track-label__select", label));
    await expect
      .element(
        page
          .elementLocator(label)
          .getByRole("textbox", { name: "Layer name" }),
      )
      .toHaveFocus();
    expect(height(row)).toBe(expandedHeight);
  });

  test("double-clicking a source track's label collapses and expands it", async () => {
    await addVideoClips();
    const row = sourceRow();
    const label = query(".track-label", row);
    const clipText = query(".source-span__body span", row);
    const expandedHeight = height(row);
    const expandedLayout = labelLayout(label, clipText);
    const expandedSwitches = switchBoxes(label);
    expect(Object.keys(expandedSwitches)).toEqual(SWITCHES);

    await doubleClickBesideName(label);
    await expect.poll(() => row.className).toMatch(/track-row--collapsed/);
    expect(height(row)).toBe(COLLAPSED_HEIGHT);
    expectSameLayout(label, query(".source-span__body span", row), expandedLayout);
    const span = query(".source-span", row);
    expect(height(span)).toBe(COLLAPSED_CLIP_HEIGHT);
    expect(span.offsetTop).toBe(COLLAPSED_CLIP_INSET);
    await expect.poll(() => thumbnails(row)).toHaveLength(0);
    expectVisible(query("small", label), false);
    await expectSwitchesAsExpanded(row, label, expandedSwitches);
    // The layer showing the same media keeps its frames.
    expectVisible(query(".clip-card__tile", layerRow()));

    // The switches do nothing new.
    await doubleClick(query(".track-label__grip", label));
    expect(row.className).toMatch(/track-row--collapsed/);

    await doubleClickBesideName(label);
    await expect.poll(() => row.className).not.toMatch(/track-row--collapsed/);
    expect(height(row)).toBe(expandedHeight);
    await expect
      .poll(() => isVisible(row.querySelector(".source-span__tile")))
      .toBe(true);

    await doubleClick(query(".track-label__select", label));
    await expect
      .element(
        page
          .elementLocator(label)
          .getByRole("textbox", { name: "Source track name" }),
      )
      .toHaveFocus();
    expect(height(row)).toBe(expandedHeight);
  });

  test("collapsed text and FX clips keep their type glyphs", async () => {
    await render(<TimelineHarness />);
    await expect.poll(() => layerRow()).toBeTruthy();
    await insertClip("Insert Text Clip", 40);
    await insertClip("Insert FX Clip", 400);
    const row = layerRow();
    const glyphs = () =>
      [...row.querySelectorAll(".clip-card__glyph")].map(
        (node) => node.textContent,
      );
    await expect.poll(glyphs).toEqual(["T", "FX"]);
    const expandedWidths = [...row.querySelectorAll(".clip-card__glyph")].map(
      (node) => node.getBoundingClientRect().width,
    );

    await doubleClick(query(".track-label__index", row));
    await expect.poll(() => row.className).toMatch(/track-row--collapsed/);
    expect(glyphs()).toEqual(["T", "FX"]);
    for (const [index, kind] of ["text", "fx"].entries()) {
      const clip = query(`.clip-card--${kind}`, row);
      const glyph = query(".clip-card__glyph", clip);
      expectVisible(glyph);
      expectVisible(query(".clip-card__text strong", clip));
      const clipBox = clip.getBoundingClientRect();
      const glyphBox = glyph.getBoundingClientRect();
      expect(clipBox.height).toBe(COLLAPSED_CLIP_HEIGHT);
      expect(glyphBox.width, kind).toBe(expandedWidths[index]);
      // Centered in the clip bar.
      const above = glyphBox.y - clipBox.y;
      const below = clipBox.y + clipBox.height - (glyphBox.y + glyphBox.height);
      expect(Math.abs(above - below), kind).toBeLessThanOrEqual(0.5);
    }
    expect(thumbnails(row)).toHaveLength(0);
  });

  test("double-clicking the Audio row's label collapses and expands it", async () => {
    await render(<TimelineHarness />);
    await expect.poll(() => query("[data-audio-row]")).toBeTruthy();
    const row = query("[data-audio-row]");
    const label = query(".track-label", row);
    const toggle = () => query(".audio-row__toggle", row);
    const expanded = () => toggle().getAttribute("aria-expanded");
    const expandedHeight = height(row);
    const badge = () => query(".track-label__index", label);
    const expandedBadge = badge().getBoundingClientRect();

    // Its label's padding, left of the toggle. The docked row moves as it
    // collapses and expands.
    const doubleClickPadding = async () => {
      const box = label.getBoundingClientRect();
      await mouse.dblclick(box.x + 6, box.y + box.height / 2);
    };
    await doubleClickPadding();
    await expect.poll(expanded).toBe("false");
    expect(height(row)).toBe(COLLAPSED_HEIGHT);
    // Its index badge keeps its size and place, 8px from the top and bottom.
    const collapsedBadge = badge().getBoundingClientRect();
    expect(collapsedBadge.width).toBe(expandedBadge.width);
    expect(collapsedBadge.height).toBe(expandedBadge.height);
    expect(collapsedBadge.x).toBe(expandedBadge.x);
    expectBadgePadding(row, label);
    await doubleClickPadding();
    await expect.poll(expanded).toBe("true");
    expect(height(row)).toBe(expandedHeight);

    // A double-click on the toggle toggles once, though the row moves out
    // from under its second click.
    await doubleClick(toggle());
    await expect.poll(expanded).toBe("false");
    await doubleClick(toggle());
    await expect.poll(expanded).toBe("true");
    expect(height(row)).toBe(expandedHeight);

    // The Refresh button does nothing new.
    await doubleClick(
      page.getByRole("button", { name: "Recompute audio" }).element(),
    );
    expect(expanded()).toBe("true");
  });
});
