import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { center, down, move, up } from "../../component-test/cdp-mouse.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  sessionWithLayers,
  withTestPatternTrack,
} from "../../component-test/editor-harness.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import { ClipCard } from "./ClipCard";

// Arrangement clip trim handles stay hidden until one is hovered or trimmed,
// which shows that handle only, or the clip is focused, but keep their hit
// area. Selection alone shows only the outline, and only a clip the user
// selected looks or acts selected. ClipCard draws the handles; the editor
// harness wires its drags, selection and edit keys as App does. A
// four-second test pattern at 120 BPM spans eight quarters.
void ClipCard;

const MOD = getShortcutLabels().mac ? "Meta" : "Control";

function lane(id: string) {
  return document.querySelector<HTMLElement>(`[data-timeline-lane-id="${id}"]`);
}

function clipIn(laneId: string) {
  const clip = lane(laneId)?.querySelector<HTMLElement>(".clip-card");
  if (!clip) {
    throw new Error(`Layer ${laneId} has no clip`);
  }
  return clip;
}

function part(clip: HTMLElement, selector: string) {
  const element = clip.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Clip has no ${selector}`);
  }
  return element;
}

async function expectOpacity(element: Element, opacity: string) {
  await expect.poll(() => getComputedStyle(element).opacity).toBe(opacity);
}

async function copySpanToLayer(layer: string) {
  await userEvent.click(page.elementLocator(sourceSpan()), {
    button: "right",
  });
  await userEvent.hover(page.getByRole("menuitem", { name: "Copy to layer" }));
  await userEvent.click(page.getByRole("menuitem", { name: layer }));
}

function sourceSpan() {
  const span = document.querySelector<HTMLElement>(".source-span");
  if (!span) {
    throw new Error("No source clip");
  }
  return span;
}

async function openEditorWithLayers(count: number) {
  await renderEditor({
    project: withTestPatternTrack(sessionWithLayers(count)),
  });
  await expect
    .poll(() => document.querySelectorAll(".source-span").length)
    .toBe(1);
}

describe("ClipCard trim handles in the editor", {
  timeout: EDITOR_TEST_TIMEOUT,
}, () => {
  // The docked Audio row footer (#809) leaves less room for layers to
  // scroll in; a taller viewport keeps the layers clear of it.
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });

  test("only the hovered or trimmed handle appears, and grabs while hidden", async () => {
    await openEditorWithLayers(2);
    await copySpanToLayer("Layer 1");
    await expect
      .poll(() => lane("1")?.querySelectorAll(".clip-card").length)
      .toBe(1);
    const clip = clipIn("1");
    const start = part(clip, ".clip-card__handle--start");
    const end = part(clip, ".clip-card__handle--end");
    const body = part(clip, ".clip-card__body");

    // Select a second clip to leave this one idle.
    await copySpanToLayer("Layer 2");
    await expect
      .poll(() => lane("2")?.querySelectorAll(".clip-card").length)
      .toBe(1);
    const other = clipIn("2");
    await userEvent.click(page.elementLocator(part(other, ".clip-card__body")));
    await expect.poll(() => other.className).toMatch(/clip-card--selected/);
    // Keep the clip clear of the sticky ruler.
    clip.scrollIntoView({ block: "center" });
    await move(5, 5);
    expect(clip.className).not.toMatch(/clip-card--selected/);
    await expectOpacity(start, "0");
    await expectOpacity(end, "0");

    // The body runs edge to edge under the handles.
    const clipBox = clip.getBoundingClientRect();
    expect(body.getBoundingClientRect().width).toBeGreaterThan(
      clipBox.width - 4,
    );

    // Hidden handles keep their hit area on the clip's edges.
    const endCenter = center(end);
    expect(document.elementFromPoint(endCenter.x, endCenter.y)?.className).toBe(
      "clip-card__handle clip-card__handle--end",
    );

    // Hovering the clip's middle shows neither handle; hovering an edge shows
    // that edge's handle only (#925).
    const bodyCenter = center(body);
    await move(bodyCenter.x, bodyCenter.y);
    await expectOpacity(start, "0");
    await expectOpacity(end, "0");
    const startCenter = center(start);
    await move(startCenter.x, startCenter.y);
    await expectOpacity(start, "1");
    await expectOpacity(end, "0");
    await move(endCenter.x, endCenter.y);
    await expectOpacity(end, "1");
    await expectOpacity(start, "0");
    await move(5, 5);
    await expectOpacity(end, "0");

    // Trimming keeps the trimmed edge's handle shown, alone, even with the
    // pointer off the clip.
    const widthBefore = clipBox.width;
    await move(endCenter.x, endCenter.y);
    await down();
    await move(endCenter.x - 60, endCenter.y + 200, { steps: 6 });
    await expect.poll(() => clip.className).toMatch(/clip-card--trimming/);
    await expectOpacity(end, "1");
    await expectOpacity(start, "0");
    await up();
    await expect.poll(() => clip.className).not.toMatch(/clip-card--trimming/);
    await expect
      .poll(() => clipIn("1").getBoundingClientRect().width)
      .toBeLessThan(widthBefore - 20);

    // The trimmed clip is selected, but selection alone keeps them hidden.
    expect(clipIn("1").className).toMatch(/clip-card--selected/);
    await move(5, 5);
    await expectOpacity(part(clipIn("1"), ".clip-card__handle--start"), "0");
    await expectOpacity(part(clipIn("1"), ".clip-card__handle--end"), "0");
  });

  test("no clip looks or acts selected unless the user selected it", async () => {
    await openEditorWithLayers(2);
    await copySpanToLayer("Layer 1");
    await copySpanToLayer("Layer 2");
    const clipCount = () => document.querySelectorAll(".clip-card").length;
    const selectedCount = () =>
      document.querySelectorAll(".clip-card--selected").length;
    await expect.poll(clipCount).toBe(2);
    const clip = clipIn("1");
    const other = clipIn("2");

    // Esc clears the selection, leaving no clip highlighted.
    await userEvent.click(page.elementLocator(part(clip, ".clip-card__body")));
    await expect.poll(() => clip.className).toMatch(/clip-card--selected/);
    await userEvent.keyboard("{Escape}");
    await expect.poll(selectedCount).toBe(0);

    // With nothing selected, edit keys touch no clip.
    await userEvent.keyboard("{Delete}");
    for (const key of ["x", "e", "d"]) {
      await userEvent.keyboard(`{${MOD}>}${key}{/${MOD}}`);
    }
    expect(clipCount()).toBe(2);
    expect(selectedCount()).toBe(0);

    // Starting a range on another layer clears the selection too.
    await userEvent.click(page.elementLocator(part(other, ".clip-card__body")));
    await expect.poll(() => other.className).toMatch(/clip-card--selected/);
    const laneBox = lane("1")?.getBoundingClientRect();
    const clipBox = clip.getBoundingClientRect();
    if (!laneBox) {
      throw new Error("Layer 1 is not visible");
    }
    const y = laneBox.y + laneBox.height / 2;
    const x = clipBox.x + clipBox.width + 40;
    await move(x, y);
    await down();
    await move(x + 80, y, { steps: 4 });
    await up();
    await expect.poll(selectedCount).toBe(0);
    await move(5, 5);
    for (const card of [clipIn("1"), clipIn("2")]) {
      await expectOpacity(part(card, ".clip-card__handle--start"), "0");
    }
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Delete}");
    expect(clipCount()).toBe(2);
  });
});
